/** Cümle içinde seçilen kelimeyi işaretler. */
export default function Highlighted({ text, word }: { text: string; word: string }) {
  const i = text.toLocaleLowerCase("tr").indexOf(word.toLocaleLowerCase("tr"));
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-mark px-0.5 text-inherit">{text.slice(i, i + word.length)}</mark>
      {text.slice(i + word.length)}
    </>
  );
}
