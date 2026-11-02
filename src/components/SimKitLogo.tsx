import { cn } from "@/lib/utils";

/** Original blue and orange logo used as the SimKit identity. */
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
      <img className="simkit-logo__mark" src="/brand/simkit-mark.png" alt="" aria-hidden="true" />
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
