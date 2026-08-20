import type { WaitingRoomJoinResponse, WaitingRoomStatusResponse } from '../../shared/types/botDefense.js';
import { withAuthRetry } from './authClient.js';
import { apiUrl } from './api.js';
import { readApiError } from './apiError.js';

export async function joinWaitingRoom(showtimeId: number): Promise<WaitingRoomJoinResponse> {
  const res = await withAuthRetry((token) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(apiUrl('/api/waiting-room/join'), {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ showtimeId }),
    });
  });

  if (!res.ok) {
    const err = await readApiError(res);
    throw new Error(err.message || 'Không thể tham gia phòng chờ.');
  }
  return res.json();
}

export async function getWaitingRoomStatus(showtimeId: number): Promise<WaitingRoomStatusResponse> {
  const res = await withAuthRetry((token) => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(apiUrl(`/api/waiting-room/status?showtimeId=${showtimeId}`), {
      method: 'GET',
      headers,
      credentials: 'include',
    });
  });

  if (!res.ok) {
    const err = await readApiError(res);
    throw new Error(err.message || 'Không thể kiểm tra trạng thái phòng chờ.');
  }
  return res.json();
}
