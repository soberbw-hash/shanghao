import { BrandMark } from "../brand/BrandMark";

export const StartupSplashPage = ({ message }: { message: string }) => (
  <div className="startup-splash" role="status" aria-live="polite">
    <div className="startup-splash-content">
      <div className="startup-splash-halo" aria-hidden="true">
        <BrandMark size="lg" />
      </div>
      <div className="startup-splash-name">上号</div>
      <p className="startup-splash-message">{message}</p>
      <div className="startup-splash-progress" aria-hidden="true">
        <span />
      </div>
    </div>
  </div>
);
