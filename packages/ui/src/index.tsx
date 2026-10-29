import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  secondary?: boolean;
};

export function Button({ children, className = "", secondary = false, ...props }: ButtonProps) {
  const variant = secondary
    ? "ds-btn-secondary"
    : "ds-btn-primary";
  return (
    <button
      {...props}
      className={`ds-btn disabled:cursor-not-allowed ${variant} ${className}`}
    >
      {children}
    </button>
  );
}
