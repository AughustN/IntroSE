import { pool } from "./pool.js";
import { generateUniqueSlug } from "../modules/catalog/slug.js";

async function seedOrganizerAnalyticsData() {
  const targetEmail = "datthanh121206@gmail.com";
  const targetName = "NoToDo";

  console.log(`Starting seed for organizer account: ${targetEmail} (${targetName})...`);

  // 1. Find or Create User
  let userRes = await pool.query(`SELECT id FROM users WHERE email = $1`, [targetEmail]);
  let userId: number;

  if (userRes.rows.length > 0) {
    userId = Number(userRes.rows[0].id);
    console.log(`Found existing user ID: ${userId}`);
    await pool.query(`UPDATE users SET nickname = $1 WHERE id = $2`, [targetName, userId]);
  } else {
    const newUser = await pool.query(
      `INSERT INTO users (email, nickname, password_hash, provider, status)
       VALUES ($1, $2, '$2b$10$e8w0O4pPzW9Hk/7/22.4Ou4zR2q65Y5pW0v8lq4aGzJ5iX7x7x7x7', 'email', 'active')
       RETURNING id`,
      [targetEmail, targetName],
    );
    userId = Number(newUser.rows[0].id);
    console.log(`Created new user ID: ${userId}`);
  }

  // Ensure Wallet
  await pool.query(
    `INSERT INTO wallets (user_id, balance_amount)
     VALUES ($1, 100000000)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );

  // 2. Find or Create Approved Organizer
  let orgRes = await pool.query(`SELECT id FROM organizers WHERE user_id = $1`, [userId]);
  let orgId: number;

  if (orgRes.rows.length > 0) {
    orgId = Number(orgRes.rows[0].id);
    await pool.query(`UPDATE organizers SET status = 'approved', display_name = $1 WHERE id = $2`, [
      targetName,
      orgId,
    ]);
    console.log(`Updated organizer ID: ${orgId} to status = 'approved'`);
  } else {
    const newOrg = await pool.query(
      `INSERT INTO organizers (user_id, display_name, status)
       VALUES ($1, $2, 'approved')
       RETURNING id`,
      [userId, targetName],
    );
    orgId = Number(newOrg.rows[0].id);
    console.log(`Created approved organizer ID: ${orgId}`);
  }

  // 3. Find or Create Venue
  let venueRes = await pool.query(`SELECT id FROM venues WHERE created_by = $1 LIMIT 1`, [userId]);
  let venueId: number;

  if (venueRes.rows.length > 0) {
    venueId = Number(venueRes.rows[0].id);
  } else {
    const newVenue = await pool.query(
      `INSERT INTO venues (created_by, name, city, raw_address, guide)
       VALUES ($1, 'Sân Vận Động Quân Khu 7', 'TP.HCM', '202 Hoàng Văn Thụ, Phường 9, Phú Nhuận, TP.HCM', 'Cổng chính Hoàng Văn Thụ')
       RETURNING id`,
      [userId],
    );
    venueId = Number(newVenue.rows[0].id);
    console.log(`Created venue ID: ${venueId}`);
  }

  // Categories map
  const catRes = await pool.query(`SELECT id, code FROM event_categories`);
  const catMap: Record<string, number> = {};
  catRes.rows.forEach((r) => {
    catMap[r.code] = Number(r.id);
  });

  const musicCatId = catMap["music"] || 1;
  const workshopCatId = catMap["workshop"] || 2;
  const sportsCatId = catMap["sports"] || 5;
  const exhibitionCatId = catMap["exhibition"] || 6;

  // Clear existing events for this specific organizer to ensure a clean, consistent seed dataset
  const existingEvents = await pool.query(`SELECT id FROM events WHERE organizer_id = $1`, [orgId]);
  if (existingEvents.rows.length > 0) {
    const eIds = existingEvents.rows.map((r) => r.id);
    await pool.query(`DELETE FROM checkin_records WHERE event_id = ANY($1::bigint[])`, [eIds]);
    await pool.query(
      `DELETE FROM tickets WHERE order_id IN (
        SELECT o.id FROM orders o JOIN reservations r ON r.id = o.reservation_id JOIN showtimes s ON s.id = r.showtime_id WHERE s.event_id = ANY($1::bigint[])
      )`,
      [eIds],
    );
    await pool.query(
      `DELETE FROM payment_transactions WHERE order_id IN (
        SELECT o.id FROM orders o JOIN reservations r ON r.id = o.reservation_id JOIN showtimes s ON s.id = r.showtime_id WHERE s.event_id = ANY($1::bigint[])
      )`,
      [eIds],
    );
    await pool.query(
      `DELETE FROM orders WHERE reservation_id IN (
        SELECT r.id FROM reservations r JOIN showtimes s ON s.id = r.showtime_id WHERE s.event_id = ANY($1::bigint[])
      )`,
      [eIds],
    );
    await pool.query(
      `DELETE FROM reservation_items WHERE reservation_id IN (
        SELECT r.id FROM reservations r JOIN showtimes s ON s.id = r.showtime_id WHERE s.event_id = ANY($1::bigint[])
      )`,
      [eIds],
    );
    await pool.query(
      `DELETE FROM reservations WHERE showtime_id IN (
        SELECT s.id FROM showtimes s WHERE s.event_id = ANY($1::bigint[])
      )`,
      [eIds],
    );
    await pool.query(`DELETE FROM ticket_tiers WHERE showtime_id IN (SELECT id FROM showtimes WHERE event_id = ANY($1::bigint[]))`, [eIds]);
    await pool.query(`DELETE FROM showtimes WHERE event_id = ANY($1::bigint[])`, [eIds]);
    await pool.query(`DELETE FROM events WHERE organizer_id = $1`, [orgId]);
    console.log(`Cleaned up previous test events for organizer ID: ${orgId}`);
  }

  const now = new Date();

  // Define 5 Realistic Events
  const eventsConfig = [
    {
      title: "Concert Đêm Nhạc Mùa Thu - NoToDo Live 2026",
      catId: musicCatId,
      catText: "Music",
      status: "on_sale",
      modStatus: "approved",
      startsAtOffsetDays: 10,
      image: "https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?auto=format&fit=crop&q=80&w=800",
      tiers: [
        { label: "VIP Pass", price: 1500000, totalCap: 200, soldCount: 160 },
        { label: "Standard", price: 500000, totalCap: 500, soldCount: 420 },
        { label: "Early Bird", price: 350000, totalCap: 300, soldCount: 300 }, // Sold out!
      ],
      isUpcomingGauge: true,
      hasCheckins: true,
    },
    {
      title: "Masterclass Lập Trình UI/UX & Web App 2026",
      catId: workshopCatId,
      catText: "Workshop",
      status: "on_sale",
      modStatus: "approved",
      startsAtOffsetDays: 5,
      image: "https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&q=80&w=800",
      tiers: [
        { label: "Premium Workshop", price: 450000, totalCap: 150, soldCount: 90 },
        { label: "Student Pass", price: 250000, totalCap: 100, soldCount: 60 },
      ],
      isUpcomingGauge: false,
      hasCheckins: false,
    },
    {
      title: "Giải Chạy Marathon Quốc Tế TP.HCM 2026",
      catId: sportsCatId,
      catText: "Sports",
      status: "finished",
      modStatus: "approved",
      startsAtOffsetDays: -15,
      image: "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&q=80&w=800",
      tiers: [
        { label: "Half Marathon 21km", price: 650000, totalCap: 400, soldCount: 380 },
        { label: "Fun Run 10km", price: 350000, totalCap: 600, soldCount: 550 },
      ],
      isUpcomingGauge: false,
      hasCheckins: false,
    },
    {
      title: "Lễ Hội Âm Nhạc Bãi Biển Summer Waves",
      catId: musicCatId,
      catText: "Music",
      status: "cancelled",
      modStatus: "approved",
      startsAtOffsetDays: -2,
      image: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&q=80&w=800",
      tiers: [
        { label: "Festival Pass", price: 600000, totalCap: 300, soldCount: 100 },
      ],
      isRefundedEvent: true,
      isUpcomingGauge: false,
      hasCheckins: false,
    },
    {
      title: "Triển Lãm Nghệ Thuật Số & AI Art 2026",
      catId: exhibitionCatId,
      catText: "Triển lãm",
      status: "draft",
      modStatus: "pending_review",
      startsAtOffsetDays: 30,
      image: "https://images.unsplash.com/photo-1561214115-f2f134cc4912?auto=format&fit=crop&q=80&w=800",
      tiers: [
        { label: "Entry Pass", price: 150000, totalCap: 200, soldCount: 0 },
      ],
      isUpcomingGauge: false,
      hasCheckins: false,
    },
  ];

  let totalSeededOrders = 0;
  let totalSeededTickets = 0;
  let event1TicketsForCheckin: number[] = [];
  let event1Id: number = 0;

  for (const cfg of eventsConfig) {
    const slug = await generateUniqueSlug(cfg.title);
    const startsAt = new Date(now.getTime() + cfg.startsAtOffsetDays * 24 * 60 * 60 * 1000);

    const evt = await pool.query(
      `INSERT INTO events (slug, organizer_id, category_id, title, description, event_type, status,
                           moderation_status, image_url, category, refund_policy, age_restriction)
       VALUES ($1, $2, $3, $4, $5, 'general_admission', $6, $7, $8, $9, 'Hoàn tiền 100% khi hủy sự kiện', 'all')
       RETURNING id`,
      [
        slug,
        orgId,
        cfg.catId,
        cfg.title,
        `Sự kiện ${cfg.title} được tổ chức chuyên nghiệp bởi ${targetName}. Trải nghiệm tuyệt vời cho khán giả.`,
        cfg.status,
        cfg.modStatus,
        cfg.image,
        cfg.catText,
      ],
    );

    const eventId = Number(evt.rows[0].id);
    if (cfg.hasCheckins) event1Id = eventId;

    const st = await pool.query(
      `INSERT INTO showtimes (event_id, venue_id, starts_at, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [eventId, venueId, startsAt.toISOString(), cfg.status === "cancelled" ? "cancelled" : "on_sale"],
    );
    const showtimeId = Number(st.rows[0].id);

    for (const tierCfg of cfg.tiers) {
      const tt = await pool.query(
        `INSERT INTO ticket_tiers (showtime_id, label, price_amount, total_quantity, sold_quantity, description)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [showtimeId, tierCfg.label, tierCfg.price, tierCfg.totalCap, tierCfg.soldCount, `Vé ${tierCfg.label}`],
      );
      const tierId = Number(tt.rows[0].id);

      if (tierCfg.soldCount > 0) {
        // Create orders & tickets in batches
        const ticketsPerOrder = 10;
        const numOrders = Math.ceil(tierCfg.soldCount / ticketsPerOrder);

        for (let oIdx = 0; oIdx < numOrders; oIdx++) {
          const qty = oIdx === numOrders - 1 ? tierCfg.soldCount - (numOrders - 1) * ticketsPerOrder : ticketsPerOrder;
          if (qty <= 0) continue;

          // Spread purchase timestamps over the last 60 days
          const daysAgo = Math.floor((oIdx / numOrders) * 55) + Math.floor(Math.random() * 5);
          const orderDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

          const resv = await pool.query(
            `INSERT INTO reservations (showtime_id, user_id, status, created_at, expires_at)
             VALUES ($1, $2, 'converted', $3, $3)
             RETURNING id`,
            [showtimeId, userId, orderDate.toISOString()],
          );
          const resvId = Number(resv.rows[0].id);

          const resvItem = await pool.query(
            `INSERT INTO reservation_items (reservation_id, ticket_tier_id, quantity, unit_price_amount)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [resvId, tierId, qty, tierCfg.price],
          );
          const resvItemId = Number(resvItem.rows[0].id);

          const isRefunded = cfg.isRefundedEvent || false;
          const orderCode = `ORD-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
          const subtotal = tierCfg.price * qty;
          const serviceFee = Math.round(subtotal * 0.05);
          const finalTotal = subtotal + serviceFee;

          const orderStatus = "paid";

          const ord = await pool.query(
            `INSERT INTO orders (order_code, user_id, reservation_id, customer_name, customer_email, customer_phone,
                                 subtotal_cents, service_fee_cents, discount_cents, final_total_cents, payment_method, payment_status, created_at)
             VALUES ($1, $2, $3, $4, $5, '0901234567', $6, $7, 0, $8, 'wallet', $9, $10)
             RETURNING id`,
            [
              orderCode,
              userId,
              resvId,
              `Khách Hàng ${oIdx + 1}`,
              `buyer${oIdx + 1}@example.com`,
              subtotal,
              serviceFee,
              finalTotal,
              orderStatus,
              orderDate.toISOString(),
            ],
          );
          const orderId = Number(ord.rows[0].id);
          totalSeededOrders++;

          // Insert Payment Transaction Record
          await pool.query(
            `INSERT INTO payment_transactions (order_id, user_id, payment_kind, provider, provider_txn_id, provider_txn_ref, amount_cents, status, created_at)
             VALUES ($1, $2, 'order', 'wallet', $3, $3, $4, $5, $6)
             ON CONFLICT (provider, provider_txn_ref) DO NOTHING`,
            [orderId, userId, `TXN-${orderCode}`, finalTotal, isRefunded ? "refunded" : "success", orderDate.toISOString()],
          );

          // Insert Ticket Rows
          for (let t = 0; t < qty; t++) {
            const barcode = `BAR-${orderId}-${t + 1}-${Math.floor(10000 + Math.random() * 90000)}`;
            const qrHash = `HASH-${barcode}`;
            const qrStatus = isRefunded ? "void" : "unused";

            const tck = await pool.query(
              `INSERT INTO tickets (order_id, reservation_item_id, price_cents, refundable_amount, qr_token_hash, barcode_value, qr_status, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               RETURNING id`,
              [orderId, resvItemId, tierCfg.price, tierCfg.price, qrHash, barcode, qrStatus, orderDate.toISOString()],
            );
            const ticketId = Number(tck.rows[0].id);
            totalSeededTickets++;

            if (cfg.hasCheckins && !isRefunded) {
              event1TicketsForCheckin.push(ticketId);
            }
          }
        }
      }
    }

    console.log(`Seeded event: "${cfg.title}" (Status: ${cfg.status})`);
  }

  // 4. Seed Check-in Records for Event 1
  if (event1TicketsForCheckin.length > 0 && event1Id > 0) {
    const checkinCount = Math.min(45, event1TicketsForCheckin.length);
    for (let c = 0; c < checkinCount; c++) {
      const tckId = event1TicketsForCheckin[c];
      const scanDate = new Date(now.getTime() - Math.floor(Math.random() * 120) * 60 * 1000);

      await pool.query(
        `INSERT INTO checkin_records (ticket_id, event_id, scanned_at, scanned_by_user_id, status)
         VALUES ($1, $2, $3, $4, 'VALID')`,
        [tckId, event1Id, scanDate.toISOString(), userId],
      );

      // Update ticket qr_status to checked_in
      await pool.query(
        `UPDATE tickets SET qr_status = 'checked_in', checked_in_at = $1, checked_in_by = $2 WHERE id = $3`,
        [scanDate.toISOString(), userId, tckId],
      );
    }
    console.log(`Seeded ${checkinCount} checkin_records for Event ID: ${event1Id}`);
  }

  console.log(`\n🎉 Seed completed successfully!`);
  console.log(`- Target Account: ${targetEmail} (Organizer ID: ${orgId})`);
  console.log(`- Total Events: ${eventsConfig.length}`);
  console.log(`- Total Orders: ${totalSeededOrders}`);
  console.log(`- Total Tickets: ${totalSeededTickets}`);
}

seedOrganizerAnalyticsData()
  .then(() => {
    console.log("Database seed script finished.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Seed script failed:", err);
    process.exit(1);
  });
