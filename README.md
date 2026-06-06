# TixHub — Event Ticket Sales Web Application

> Group 02 · Intro to Software Engineering (Intro2SE) — 24C11 · HCMUS

TixHub is a web platform for selling and managing tickets to entertainment events. It connects three roles — **Admin**, **Organizer**, and **Attendee** — on one marketplace: organizers publish events and sell tickets, attendees pay securely and check in at the door via QR code.

## Team — Group 02

| Name | ID | Role |
| --- | --- | --- |
| Lương Hưng Phát | 24127298 | PM / Backend (Team Leader) |
| Nguyễn Thành Đạt | 24127021 | Fullstack / Tester |
| Nguyễn Minh Khoa | 24127188 | Backend |
| Nguyễn Tấn Hiệu | 24127373 | Frontend / DevOps |
| Nguyễn Anh Khôi | 24127430 | Database |

## Highlights

- **Event creation & management** — general-admission and reserved-seating events with a real-time seat map.
- **Secure checkout** — VNPay payment gateway; every buyer gets a unique QR-code digital ticket.
- **Door check-in** — phone QR scanning with live attendance and duplicate blocking.
- **Discovery** — browse, search, and filter by keyword, category, date, location, price.
- **Two AI features (Google Gemini)** — personalized event recommendations for attendees, and a listing assistant that helps organizers write descriptions, titles, tags, and suggested prices.
- **Real-time analytics, notifications & waitlist, reviews & ratings, admin moderation.**

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React, Recharts, html5-qrcode |
| Backend | Node.js, Express, Socket.IO |
| Database | PostgreSQL |
| Payments | VNPay (sandbox) |
| AI | Google Gemini API |
| CI/CD | GitHub Actions |

## Documentation

- **[Project Proposal](./Group02_ProjectProposal.md)** — full proposal ([PDF](./Group02_ProjectProposal.pdf)).

---

*Academic project — built entirely on free service tiers and student equipment.
