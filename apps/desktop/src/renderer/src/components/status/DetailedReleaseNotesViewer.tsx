import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { ReleaseHistoryEntry } from "./releaseHistory";
import { Button } from "../base/Button";

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
    if (separator <= 0) return item;
    return (
      <>
        <strong className="release-notes-detail-keyword">{item.slice(0, separator + 1)}</strong>
        {item.slice(separator + 1)}
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
          {pageIndex === 0 && release.summary ? <p>{release.summary}</p> : null}
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
