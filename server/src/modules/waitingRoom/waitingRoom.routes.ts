import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { joinWaitingRoom, getWaitingRoomStatus } from '../../services/waitingRoom.service.js';
import { pool } from '../../db/pool.js';

export const waitingRoomRouter = Router();

/**
 * Join Virtual Waiting Room for a showtime
 * POST /api/waiting-room/join
 */
waitingRoomRouter.post('/join', requireAuth, async (req, res) => {
  const showtimeId = Number(req.body.showtimeId);
  if (!showtimeId || Number.isNaN(showtimeId)) {
    return res.status(400).json({ error: 'invalid_showtime_id', message: 'Mã suất chiếu không hợp lệ.' });
  }

  // Check if showtime exists and if high demand protection is enabled
  const check = await pool.query(
    `SELECT s.id, e.is_high_demand FROM showtimes s
     JOIN events e ON s.event_id = e.id
     WHERE s.id = $1`,
    [showtimeId],
  );

  if (check.rows.length === 0) {
    return res.status(404).json({ error: 'showtime_not_found', message: 'Suất chiếu không tồn tại.' });
  }

  const userId = req.auth!.userId;
  const isHighDemand = Boolean(check.rows[0].is_high_demand);

  if (!isHighDemand) {
    return res.json({
      status: 'admitted',
      showtimeId,
      message: 'Sự kiện này không yêu cầu phòng chờ.',
    });
  }

  const result = joinWaitingRoom(showtimeId, userId);
  return res.json(result);
});

/**
 * Poll Virtual Waiting Room Status
 * GET /api/waiting-room/status?showtimeId=...
 */
waitingRoomRouter.get('/status', requireAuth, (req, res) => {
  const showtimeId = Number(req.query.showtimeId);
  if (!showtimeId || Number.isNaN(showtimeId)) {
    return res.status(400).json({ error: 'invalid_showtime_id', message: 'Mã suất chiếu không hợp lệ.' });
  }

  const userId = req.auth!.userId;
  const status = getWaitingRoomStatus(showtimeId, userId);
  return res.json(status);
});
