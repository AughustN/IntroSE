import { Resend } from "resend";
import { config } from "../../config.js";
import { MAIL_SANS, mailDocument } from "../../services/mailStyle.js";

// Empty RESEND_API_KEY → ConsoleMailer (prints the link). Tests rely on this.
const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;

export interface Mailer {
  sendPasswordReset(to: string, link: string): Promise<void>;
}

export const mailer: Mailer = {
  async sendPasswordReset(to: string, link: string): Promise<void> {
    if (!resend) {
      console.warn(`[ConsoleMailer] password reset for ${to}: ${link}`);
      return;
    }
    const { error } = await resend.emails.send({
      from: config.mailFrom,
      to,
      subject: "Đặt lại mật khẩu TixHub",
      text: `Đặt lại mật khẩu TixHub\n\nNhấn vào liên kết để đặt lại mật khẩu (hết hạn sau 30 phút):\n${link}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này.`,
      html: mailDocument(`<div style="margin:0;padding:32px 16px;background:#12312f;font-family:${MAIL_SANS};color:#12312f">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;border:4px solid #12312f;border-radius:12px;overflow:hidden;background:#e0e2ca;box-shadow:0 8px 22px rgba(0,0,0,.18)">
          <tr><td style="padding:24px 28px;background:#7a2f35;border-bottom:4px dashed #12312f;color:#ffffff;font-family:${MAIL_SANS}">
            <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#e0e2ca">TixHub</div>
            <div style="margin-top:8px;font-size:25px;font-weight:800;line-height:32px">Đặt lại mật khẩu</div>
          </td></tr>
          <tr><td style="padding:28px;background:#e0e2ca;font-family:${MAIL_SANS}">
            <p style="margin:0;font-size:15px;line-height:24px">Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản TixHub của bạn.</p>
            <div style="margin:24px 0;text-align:center"><a href="${link}" style="display:inline-block;padding:13px 22px;border:2px solid #12312f;border-radius:6px;background:#12312f;color:#e0e2ca;font-size:14px;font-weight:700;text-decoration:none">ĐẶT LẠI MẬT KHẨU</a></div>
            <div style="padding:14px 16px;border-left:3px solid #ba8248;background:#fff8ed;font-size:13px;line-height:20px;color:#4b5563"><strong style="color:#7a2f35">Liên kết hết hạn sau 30 phút.</strong><br>Nếu bạn không yêu cầu thao tác này, hãy bỏ qua email. Mật khẩu hiện tại sẽ không thay đổi.</div>
            <div style="margin-top:24px;padding-top:18px;border-top:2px dashed rgba(18,49,47,.35);font-size:13px;line-height:20px;color:#49615c">Cần hỗ trợ? Liên hệ <a href="mailto:support@tixhub.fit" style="color:#7a2f35;font-weight:700">support@tixhub.fit</a>.</div>
          </td></tr>
        </table>
      </div>`),
    });
    // The SDK reports API failures in the result, not by throwing — an unverified sending domain
    // comes back as a 403 here. Left unchecked it looks identical to a delivered mail, so the caller
    // is told nothing and the buyer waits for a link that was never sent. Throw so the route's
    // handler logs it (it still answers 200, by design, to keep the response uniform).
    if (error) {
      throw new Error(`${error.name ?? "send_failed"}: ${error.message ?? "unknown Resend error"}`);
    }
  },
};
