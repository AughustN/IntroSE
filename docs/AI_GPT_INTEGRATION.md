# AI Integration

Hai endpoint AI duoc cai dat theo UC-10 va UC-22:

- `POST /api/ai/recommendations`: attendee da dang nhap hoi goi y su kien.
- `POST /api/ai/event-assistant`: organizer da duyet tao goi y listing.

`OpenAIProvider` la provider duy nhat hien tai va chi duoc goi tu backend. Mọi event tra ve cho frontend deu la candidate tu PostgreSQL; model chi xep hang ID va viet ly do. Ket qua listing luon la draft co the sua truoc khi tao event.

## Configuration

Dat cac bien nay tren backend, khong dat bat ky key nao trong `VITE_*` hay frontend:

```env
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

Backend tu noi `/chat/completions` vao `OPENAI_BASE_URL`. Voi MayeAPI, dat `OPENAI_BASE_URL=https://mayeapi.xyz/v1` va dat `OPENAI_MODEL` dung model/token group da chon trong console. Neu can endpoint dac biet, `OPENAI_CHAT_URL` van co the ghi de URL day du. Provider phai tra ve OpenAI Chat Completions shape `choices[0].message.content` chua JSON. Neu provider chua cau hinh, timeout (60 giay), tra 429/5xx, hoac tra JSON sai, recommendation tu dong dung candidate database; listing giu form nhap tay hoat dong.

## Persistence va gioi han

- Migration `0016_ai.sql` tao cache response, per-user hourly rate limit (`10` request/gio), bookmark va view history.
- Cache TTL la 1 gio. Cache, rate limit va fallback dung PostgreSQL de giu ha tang hien co; khong can Redis.
- Admin co the tat `ai_features_enabled`; luc do backend khong goi provider.

## Deploy

```powershell
npm run db:migrate
npm run build
```

Khoi dong lai backend sau khi cap nhat env. Khong ghi key vao repository hoac chat log; neu mot key that tung bi chia se, revoke/rotate no truoc khi deploy.
