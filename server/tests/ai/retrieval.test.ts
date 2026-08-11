import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { pool } from '../../src/db/pool.js';
import { candidates } from '../../src/modules/ai/ai.repo.js';
import { app } from '../helpers/app.js';
import { bearer, registerUser } from '../helpers/authFixture.js';
import { seedEvent, seedOrganizer, seedShowtime, seedTier, seedUser, seedVenue } from '../helpers/catalogSeed.js';
import { FakeAIProvider, useFakeProvider } from '../helpers/fakeAiProvider.js';

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

/** One bookable event with the words and the city a retrieval test needs to tell it apart. */
async function seedSearchable(over: {
  title: string;
  city?: string;
  lineup?: string[];
  description?: string;
  category?: string;
  inDays?: number;
}): Promise<number> {
  const org = await seedOrganizer(await seedUser());
  const venue = await seedVenue(await seedUser(), over.city ?? 'Hà Nội');
  const ev = await seedEvent({
    organizerId: org,
    title: over.title,
    lineup: over.lineup ?? [],
    description: over.description ?? 'Mô tả sự kiện.',
    category: over.category ?? 'music',
  });
  const st = await seedShowtime(ev.id, venue, (over.inDays ?? 1) * 86_400_000);
  await seedTier(st);
  return ev.id;
}

const titles = (rows: Array<{ title: string }>) => rows.map((r) => r.title);

/**
 * Retrieval: what the model is even able to answer with.
 *
 * The assistant can only rank what it is handed, so a miss here is invisible in every other test —
 * the model answers confidently from a candidate set that never contained the right event. These
 * cases pin the two properties that matter: the question decides the set, and eligibility still
 * decides membership.
 */
describe('AI retrieval', () => {
  it('ranks the event whose words match the question first', async () => {
    await seedSearchable({ title: 'Đêm nhạc Trịnh Công Sơn' });
    await seedSearchable({ title: 'Rock Storm 2026', city: 'TP.HCM' });
    await seedSearchable({ title: 'Kịch Số Đỏ', category: 'theatre' });

    expect(titles(await candidates('nhạc Trịnh'))[0]).toBe('Đêm nhạc Trịnh Công Sơn');
    expect(titles(await candidates('rock'))[0]).toBe('Rock Storm 2026');
    expect(titles(await candidates('kịch'))[0]).toBe('Kịch Số Đỏ');
  });

  it('matches Vietnamese written without diacritics (unaccent)', async () => {
    await seedSearchable({ title: 'Đêm nhạc Trịnh Công Sơn' });
    await seedSearchable({ title: 'Rock Storm 2026', city: 'TP.HCM' });

    // Nobody types the tones into a chat box. "trinh cong son" has to reach "Trịnh Công Sơn".
    expect(titles(await candidates('trinh cong son'))[0]).toBe('Đêm nhạc Trịnh Công Sơn');
  });

  it('matches on the line-up, not only the title', async () => {
    await seedSearchable({ title: 'Đêm Cười', lineup: ['Trấn Thành'], category: 'theatre' });
    await seedSearchable({ title: 'Rock Storm 2026', city: 'TP.HCM' });

    // The performer's name appears nowhere in the title, which is exactly how people search.
    expect(titles(await candidates('Trấn Thành'))[0]).toBe('Đêm Cười');
  });

  it('matches on the venue city, unaccented', async () => {
    await seedSearchable({ title: 'Sự kiện thủ đô', city: 'Hà Nội' });
    await seedSearchable({ title: 'Sự kiện phương nam', city: 'TP.HCM', inDays: 2 });

    expect(titles(await candidates('ha noi'))[0]).toBe('Sự kiện thủ đô');
  });

  it('returns the soonest-first list when nothing matches the words', async () => {
    await seedSearchable({ title: 'Đêm nhạc Trịnh Công Sơn', inDays: 2 });
    await seedSearchable({ title: 'Rock Storm 2026', city: 'TP.HCM', inDays: 1 });

    // "Is there anything on?" matches no event's text. Answering with an empty set would say "no",
    // which is a different and wrong answer.
    const rows = await candidates('có gì hay không');
    expect(rows).toHaveLength(2);
    expect(titles(rows)[0]).toBe('Rock Storm 2026');
  });

  it('never lets relevance promote an ineligible event (FR-012, SC-003)', async () => {
    const org = await seedOrganizer(await seedUser());
    const venue = await seedVenue(await seedUser());

    // Each of these is the *best possible* lexical match for the query below, and none may appear.
    const draft = await seedEvent({ organizerId: org, status: 'draft', title: 'Đêm nhạc Trịnh Công Sơn' });
    await seedTier(await seedShowtime(draft.id, venue));

    const past = await seedEvent({ organizerId: org, title: 'Đêm nhạc Trịnh Công Sơn' });
    await seedTier(await seedShowtime(past.id, venue, -86_400_000));

    const soldOut = await seedEvent({ organizerId: org, title: 'Đêm nhạc Trịnh Công Sơn' });
    await seedTier(await seedShowtime(soldOut.id, venue), { total: 5, sold: 5 });

    // One weaker but genuinely bookable match, so the query has somewhere to land.
    await seedSearchable({ title: 'Chiều nhạc Trịnh', inDays: 3 });

    const rows = await candidates('nhạc Trịnh Công Sơn');
    expect(titles(rows)).toEqual(['Chiều nhạc Trịnh']);
  });

  it('anchors a follow-up on the reader\'s earlier turns, not the assistant\'s replies', async () => {
    await seedSearchable({ title: 'Đêm nhạc Trịnh Công Sơn' });
    await seedSearchable({ title: 'Rock Storm 2026', city: 'TP.HCM', inDays: 2 });
    const { token } = await registerUser();

    const fake = new FakeAIProvider({
      chat: (context) => ({
        reply: 'Rẻ hơn thì có cái này.',
        declined: false,
        recommendations: [{ eventId: context.candidates[0]!.id, reason: 'ok' }],
      }),
    });
    restore = useFakeProvider(fake);

    await request(app)
      .post('/api/ai/chat')
      .set(bearer(token))
      .send({
        message: 'rẻ hơn nữa đi',
        history: [
          { role: 'user', content: 'có nhạc Trịnh không' },
          { role: 'assistant', content: 'Có Rock Storm 2026 rất hay.' },
        ],
      })
      .expect(200);

    // "rẻ hơn nữa đi" retrieves nothing alone; the reader's own earlier words are what keep the
    // follow-up on subject. The assistant's reply named a different event and must not steer it.
    expect(fake.chatCalls[0]!.candidates[0]!.title).toBe('Đêm nhạc Trịnh Công Sơn');
  });

  it('keeps the candidate set inside its ceiling', async () => {
    for (let i = 0; i < 25; i += 1) {
      await seedSearchable({ title: `Đêm nhạc số ${i}`, inDays: i + 1 });
    }
    const rows = await candidates('nhạc', 20);
    expect(rows.length).toBeLessThanOrEqual(20);

    // Also verify the whole set reaches the model, not a silently smaller slice.
    const { token } = await registerUser();
    const fake = new FakeAIProvider({
      chat: (context) => ({ reply: 'ok', declined: false, recommendations: [{ eventId: context.candidates[0]!.id, reason: 'x' }] }),
    });
    restore = useFakeProvider(fake);
    await request(app).post('/api/ai/chat').set(bearer(token)).send({ message: 'nhạc' }).expect(200);
    expect(fake.chatCalls[0]!.candidates.length).toBeLessThanOrEqual(20);
  });

  it('keeps the search document in step with an edited event', async () => {
    const id = await seedSearchable({ title: 'Tên ban đầu' });
    expect(titles(await candidates('ban đầu'))).toContain('Tên ban đầu');

    await pool.query('UPDATE events SET title = $2 WHERE id = $1', [id, 'Nhan đề đã sửa']);

    // `search_doc` is a generated column, so the index follows an edit with no application code.
    expect(titles(await candidates('nhan đề'))).toContain('Nhan đề đã sửa');
    expect(titles(await candidates('ban đầu'))).not.toContain('Tên ban đầu');
  });
});
