import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";

import type { ReleaseHistoryEntry } from "./releaseHistory";
import { Button } from "../base/Button";

const RELEASE_EMPHASIS_PATTERN =
  /(新增|修复|优化|支持|不会|避免|保留|默认|可以|只在|不再|继续|无需|成功|失败|更稳|更放心|少一点)/g;

const getHighlightMarker = (text: string) => {
  if (/(修复|错误|问题|失败)/.test(text)) return "🛠️";
  if (/(性能|后台|资源|速度|占用|流畅)/.test(text)) return "⚡";
  if (/(新增|支持|快捷|模型|功能)/.test(text)) return "✨";
  return "🎯";
};

const renderReleaseText = (text: string) => {
  const parts = text.split(RELEASE_EMPHASIS_PATTERN);
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <strong key={`${part}-${index}`} className="release-notes-inline-emphasis">
        {part}
      </strong>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    ),
  );
};

export const DetailedReleaseNotesViewer = ({
  release,
  onComplete,
  completeLabel = "知道了，开始上号",
}: {
  release: ReleaseHistoryEntry;
  onComplete: () => void;
  completeLabel?: string;
}) => {
  const [pageIndex, setPageIndex] = useState(0);
  const pages = release.details;
  const page = pages[pageIndex] ?? pages[0];

  useEffect(() => setPageIndex(0), [release.version]);

  if (!page) return null;

  const isLastPage = pageIndex === pages.length - 1;
  const renderDetail = (item: string) => {
    const separator = item.indexOf("：");
    if (separator <= 0) return renderReleaseText(item);
    return (
      <>
        <strong className="release-notes-detail-keyword">{item.slice(0, separator + 1)}</strong>
        {renderReleaseText(item.slice(separator + 1))}
      </>
    );
  };
  return (
    <div className="release-notes-viewer">
      <div className="release-notes-page" aria-live="polite">
        <div>
          <div className="release-notes-kicker">
            {release.date} · {release.version}
          </div>
          <h3>{page.title}</h3>
          {pageIndex === 0 ? (
            <section className="release-notes-summary-card" aria-label="本次更新重点">
              <div className="release-notes-summary-heading">
                <span>
                  <Sparkles aria-hidden="true" />
                  先看重点
                </span>
                <small>用大白话说</small>
              </div>
              {release.summary ? <p>{renderReleaseText(release.summary)}</p> : null}
              {release.highlights.length ? (
                <ul className="release-notes-highlight-list">
                  {release.highlights.map((highlight) => (
                    <li key={highlight}>
                      <span aria-hidden="true">{getHighlightMarker(highlight)}</span>
                      <span>{renderReleaseText(highlight)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>

        <ol className="release-notes-detail-list">
          {page.items.map((item, index) => (
            <li key={item}>
              <span className="release-notes-detail-number" aria-hidden="true">
                {index + 1}
              </span>
              <span>{renderDetail(item)}</span>
            </li>
          ))}
        </ol>
      </div>

      <footer className="release-notes-pagination">
        <Button
          variant="secondary"
          disabled={pageIndex === 0}
          onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
        >
          <ChevronLeft aria-hidden="true" />
          上一页
        </Button>
        <span aria-label={`第 ${pageIndex + 1} 页，共 ${pages.length} 页`}>
          {pageIndex + 1} / {pages.length}
        </span>
        {isLastPage ? (
          <Button onClick={onComplete}>{completeLabel}</Button>
        ) : (
          <Button
            onClick={() => setPageIndex((current) => Math.min(pages.length - 1, current + 1))}
          >
            下一页
            <ChevronRight aria-hidden="true" />
          </Button>
        )}
      </footer>
    </div>
  );
};
