import { Resend } from 'resend';
import { config } from '../../config.js';

// Empty RESEND_API_KEY → ConsoleMailer (prints the link). Tests rely on this.
const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;

export interface Mailer {
  sendPasswordReset(to: string, link: string): Promise<void>;
}

export const mailer: Mailer = {
  async sendPasswordReset(to: string, link: string): Promise<void> {
    if (!resend) {
      console.log(`[ConsoleMailer] password reset for ${to}: ${link}`);
      return;
    }
    const { error } = await resend.emails.send({
      from: config.mailFrom,
      to,
      subject: 'Đặt lại mật khẩu TixHub',
      text: `Nhấn vào liên kết để đặt lại mật khẩu (hết hạn sau 30 phút):\n${link}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này.`,
    });
    // The SDK reports API failures in the result, not by throwing — an unverified sending domain
    // comes back as a 403 here. Left unchecked it looks identical to a delivered mail, so the caller
    // is told nothing and the buyer waits for a link that was never sent. Throw so the route's
    // handler logs it (it still answers 200, by design, to keep the response uniform).
    if (error) {
      throw new Error(`${error.name ?? 'send_failed'}: ${error.message ?? 'unknown Resend error'}`);
    }
  },
};
