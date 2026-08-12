import { describe, expect, it } from 'vitest';
import { extractJson } from '../../src/modules/ai/providers/openai.provider.js';

/**
 * What the model wraps its answer in.
 *
 * `response_format: json_object` is a request the provider is free to ignore, and the gateway this
 * project uses serves reasoning models that do: `Minimax-M3` prefixes every answer with a
 * `<think>` block. Before this parsing existed, a model that had answered perfectly was reported as
 * a provider failure and the reader got a fallback — the assistant looked broken while working.
 */
describe('completion parsing', () => {
  it('reads a plain JSON object', () => {
    expect(extractJson('{"reply":"xin chào","declined":false}')).toEqual({
      reply: 'xin chào',
      declined: false,
    });
  });

  it('skips a reasoning block emitted before the answer', () => {
    const raw = '<think>The user greeted me in Vietnamese, so I should reply in kind.</think>\n\n{"reply":"Chào bạn"}';
    expect(extractJson(raw)).toEqual({ reply: 'Chào bạn' });
  });

  it('unwraps a markdown code fence', () => {
    expect(extractJson('```json\n{"reply":"ok"}\n```')).toEqual({ reply: 'ok' });
  });

  it('finds the object inside surrounding prose', () => {
    expect(extractJson('Đây là kết quả:\n{"reply":"ok"}\nHy vọng giúp được bạn.')).toEqual({ reply: 'ok' });
  });

  it('is not fooled by a brace inside a string', () => {
    // Counting braces without skipping string literals would end the object at the first `}` in the
    // reason text and produce a truncated, unparseable slice.
    const raw = '{"reply":"giá vé {đặc biệt} hôm nay","declined":false}';
    expect(extractJson(raw)).toEqual({ reply: 'giá vé {đặc biệt} hôm nay', declined: false });
  });

  it('still rejects output with no object in it', () => {
    expect(() => extractJson('Xin lỗi, tôi không thể trả lời.')).toThrow('invalid JSON');
    expect(() => extractJson('<think>only thinking</think>')).toThrow('invalid JSON');
  });

  it('rejects a truncated object rather than guessing at it', () => {
    expect(() => extractJson('{"reply":"bị cắt giữa chừng"')).toThrow('invalid JSON');
  });
});
