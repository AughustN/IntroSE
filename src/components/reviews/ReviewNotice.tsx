/**
 * The one shape a message takes in this feature: a stroke down the left and a wash behind it.
 *
 * Copied deliberately from the moderation console rather than invented here — that screen and this
 * one report the same kinds of thing ("done", "that failed") and had been drawn two different ways,
 * so a reader moving between them had to learn the colour twice. Never a filled block.
 */
export default function ReviewNotice({
  tone,
  children,
}: {
  tone: "ok" | "error";
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`mt-4 border-l-2 px-4 py-3 font-meta text-body ${
        tone === "error" ? "border-burgundy bg-bubblegum/25" : "border-la-co bg-la-co/10"
      } text-beige-kem`}
    >
      {children}
    </div>
  );
}
