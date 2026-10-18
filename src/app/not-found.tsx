import Link from "next/link";
export default function NotFound() {
  return (
    <main>
      <h1>Página não encontrada</h1>
      <Link className="button" href="/">
        Voltar ao início
      </Link>
    </main>
  );
}
