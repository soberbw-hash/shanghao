import type { ReleaseHistoryEntry } from "./releaseHistory";
import { Button } from "../base/Button";

const renderDetail = (item: string) => {
  const separator = item.indexOf("：");
  if (separator <= 0 || separator > 18) return item;
  return (
    <>
      <strong className="release-notes-detail-keyword">{item.slice(0, separator + 1)}</strong>
      {item.slice(separator + 1)}
    </>
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
}) => (
  <div className="release-notes-viewer">
    <div className="release-notes-page">
      <div>
        <div className="release-notes-kicker">{release.date}</div>
        <h3>{release.title}</h3>
        {release.summary ? <p>{release.summary}</p> : null}
      </div>
      <section className="release-notes-summary-card" aria-label="本次更新重点">
        <h4 className="release-notes-summary-heading">本次更新</h4>
        <ul className="release-notes-highlight-list">
          {release.highlights.map((item) => (
            <li key={item}>{renderDetail(item)}</li>
          ))}
        </ul>
      </section>
      {release.details.length ? (
        <details className="release-notes-expanded" key={release.version}>
          <summary>查看完整更新 · {release.details.length} 个主题</summary>
          {release.details.map((group) => (
            <section className="release-notes-topic" key={group.title}>
              <h4>{group.title}</h4>
              <ul>
                {group.items.map((item) => (
                  <li key={item}>{renderDetail(item)}</li>
                ))}
              </ul>
            </section>
          ))}
        </details>
      ) : null}
    </div>
    <footer className="release-notes-footer">
      <span>可在「设置 → 关于上号」再次查看</span>
      <Button onClick={onComplete}>{completeLabel}</Button>
    </footer>
  </div>
);
