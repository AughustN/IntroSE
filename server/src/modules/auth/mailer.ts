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
    await resend.emails.send({
      from: config.mailFrom,
      to,
      subject: 'Đặt lại mật khẩu TixHub',
      text: `Nhấn vào liên kết để đặt lại mật khẩu (hết hạn sau 30 phút):\n${link}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này.`,
    });
  },
};
