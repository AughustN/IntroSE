import { DEFAULT_AVATAR_FG, avatarColor } from "../../services/defaultAvatar";

/**
 * The commenter's picture, or their initial on a colour.
 *
 * Seeded from the nickname rather than from the email the rest of the app uses, because a comment
 * carries no address — the API deliberately does not hand one out. The consequence is that renaming
 * yourself recolours your past comments, which is a fair trade for not publishing an email.
 */
export default function CommenterAvatar({
  nickname,
  avatarUrl,
  size = 40,
}: {
  nickname: string;
  avatarUrl: string | null;
  /** Pixels. Replies use a smaller one, which is most of what makes a thread read as a thread. */
  size?: number;
}) {
  const box = { width: size, height: size };

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        aria-hidden="true"
        referrerPolicy="no-referrer"
        loading="lazy"
        style={box}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ ...box, backgroundColor: avatarColor(nickname), color: DEFAULT_AVATAR_FG }}
      className="grid shrink-0 place-items-center rounded-full font-bold"
    >
      {nickname.charAt(0).toUpperCase()}
    </span>
  );
}
