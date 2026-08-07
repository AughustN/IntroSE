/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

interface FooterProps {
  onNavigate: (path: string) => void;
}

export default function Footer({ onNavigate }: FooterProps) {
  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    e.preventDefault();
    onNavigate(path);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <footer className="border-t border-beige-kem/25 bg-xanh-pho px-4 py-12 font-mono text-xs sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col justify-between gap-8 md:flex-row md:items-start">
        {/* Branding */}
        <div className="space-y-2 text-center md:text-left">
          <h5 className="font-display text-sm font-bold tracking-normal text-beige-kem">
            TIXHUB FRONTEND MVP
          </h5>
          <p className="max-w-xs text-[11px] leading-relaxed text-ink-soft">
            Nền tảng bán vé sự kiện âm nhạc, kịch, workshop và giải trí số 1.
          </p>
        </div>

        {/* Categorized Footer Links */}
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 text-center sm:text-left">
          {/* Column 1: Về công ty chúng tôi */}
          <div className="space-y-3">
            <h6 className="font-display text-xs font-bold uppercase tracking-wider text-beige-kem">
              Về công ty chúng tôi
            </h6>
            <ul className="space-y-2 text-beige-kem/75">
              <li>
                <a
                  href="/about-us"
                  onClick={(e) => handleLinkClick(e, "/about-us")}
                  className="transition hover:text-beige-kem hover:underline"
                >
                  Về chúng tôi
                </a>
              </li>
              <li>
                <a
                  href="/website-terms"
                  onClick={(e) => handleLinkClick(e, "/website-terms")}
                  className="transition hover:text-beige-kem hover:underline"
                >
                  Điều khoản website
                </a>
              </li>
            </ul>
          </div>

          {/* Column 2: Dành cho Khách hàng */}
          <div className="space-y-3">
            <h6 className="font-display text-xs font-bold uppercase tracking-wider text-beige-kem">
              Dành cho Khách hàng
            </h6>
            <ul className="space-y-2 text-beige-kem/75">
              <li>
                <a
                  href="/terms-of-service"
                  onClick={(e) => handleLinkClick(e, "/terms-of-service")}
                  className="transition hover:text-beige-kem hover:underline"
                >
                  Điều khoản sử dụng
                </a>
              </li>
              <li>
                <a
                  href="/refund-policy"
                  onClick={(e) => handleLinkClick(e, "/refund-policy")}
                  className="transition hover:text-beige-kem hover:underline"
                >
                  Chính sách hoàn vé
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Copyright notice */}
        <div className="space-y-1 text-center md:text-right">
          <p className="text-[11px] text-beige-kem/60">
            © 2026 TixHub. All rights reserved.
          </p>
          <p className="text-[10px] text-beige-kem/40">
            Mock data cho vé ca nhạc, hòa nhạc, kịch và phim.
          </p>
        </div>
      </div>
    </footer>
  );
}
