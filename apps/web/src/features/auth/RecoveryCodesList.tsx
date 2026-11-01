import { CopyButton } from "../../ui";

export function RecoveryCodesList({ codes }: { codes: string[] }) {
  return (
    <>
      <ol className="recovery-codes" aria-label="Коди відновлення">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <CopyButton value={codes.join("\n")} label="Скопіювати коди" />
    </>
  );
}
