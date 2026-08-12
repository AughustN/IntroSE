/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import ReactMarkdown from "react-markdown";
import { ArrowLeft } from "lucide-react";

interface LegalPageProps {
  title: string;
  content: string;
  onBack?: () => void;
}

export default function LegalPage({ title, content, onBack }: LegalPageProps) {
  return (
    <div className="min-h-screen bg-xanh-pho px-4 py-8 text-beige-kem sm:px-6 sm:py-12 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-8">
        {/* Navigation & Header */}
        <div className="space-y-4 border-b border-beige-kem/20 pb-6">
          {onBack && (
            <button
              onClick={onBack}
              className="inline-flex items-center gap-2 text-eyebrow font-medium text-beige-kem/70 transition hover:text-beige-kem"
            >
              <ArrowLeft className="h-4 w-4" />
              Quay lại Trang chủ
            </button>
          )}
          <h1 className="font-display text-title-m font-black tracking-tight text-beige-kem sm:text-title-m lg:text-title-l">
            {title}
          </h1>
        </div>

        {/* Formatted Document Body */}
        <article className="prose prose-invert max-w-none space-y-4 font-sans text-body leading-relaxed text-beige-kem/85 sm:text-body">
          <ReactMarkdown
            components={{
              h1: ({ children }) => (
                <h1 className="mt-8 mb-4 font-display text-title-s font-bold text-beige-kem sm:text-title-m">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="mt-6 mb-3 font-display text-lede font-bold text-beige-kem sm:text-title-s">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="mt-4 mb-2 font-display text-body font-semibold text-beige-kem sm:text-lede">
                  {children}
                </h3>
              ),
              p: ({ children }) => <p className="mb-4 leading-relaxed">{children}</p>,
              ul: ({ children }) => <ul className="mb-4 list-disc pl-6 space-y-1">{children}</ul>,
              ol: ({ children }) => (
                <ol className="mb-4 list-decimal pl-6 space-y-1">{children}</ol>
              ),
              li: ({ children }) => <li className="leading-relaxed">{children}</li>,
              blockquote: ({ children }) => (
                <blockquote className="my-4 border-l-4 border-cam-dat pl-4 italic text-beige-kem/70">
                  {children}
                </blockquote>
              ),
              strong: ({ children }) => (
                <strong className="font-bold text-beige-kem">{children}</strong>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
