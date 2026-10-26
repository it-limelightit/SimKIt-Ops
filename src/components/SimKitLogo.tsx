import { cn } from "@/lib/utils";

/** Open S routing mark: connected operations, endorsed by Limelight IT. */
export function SimKitLogo({
  className,
  size = "default",
  iconOnly = false,
}: {
  className?: string;
  size?: "default" | "large";
  iconOnly?: boolean;
}) {
  return (
    <span
      className={cn("simkit-logo", size === "large" && "simkit-logo--large", className)}
      role="img"
      aria-label="SimKit Ops by Limelight IT"
    >
      <svg className="simkit-logo__mark" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <path
          d="M44 13H25a10 10 0 0 0 0 20h14a10 10 0 0 1 0 20H15"
          stroke="#159FD0"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d="M32 33h7a10 10 0 0 1 0 20H15"
          stroke="#0C78B5"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <circle className="simkit-logo__signal" cx="49" cy="13" r="6" fill="#FA8C16" />
        <path
          d="M49 2a11 11 0 0 1 11 11"
          stroke="#159FD0"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      {!iconOnly && (
        <span className="simkit-logo__type" aria-hidden="true">
          <span className="simkit-logo__name">
            simkit<span className="simkit-logo__ops">ops</span>
          </span>
          <span className="simkit-logo__endorsement">
            LIMELIGHT <strong>IT</strong>
          </span>
        </span>
      )}
    </span>
  );
}
