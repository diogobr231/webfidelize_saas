import type { MarketingCampaign } from "./marketing";

function xml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
function wrap(value: string, width: number, maxLines: number) {
  const chunks = value
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .flatMap((word) => {
      const characters = Array.from(word);
      return Array.from(
        { length: Math.ceil(characters.length / width) },
        (_, i) => characters.slice(i * width, (i + 1) * width).join(""),
      );
    });
  const lines: string[] = [];
  for (const word of chunks) {
    const last = lines.at(-1);
    if (last && Array.from(`${last} ${word}`).length <= width)
      lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines && visible.length)
    visible[visible.length - 1] =
      Array.from(visible.at(-1)!)
        .slice(0, width - 1)
        .join("") + "…";
  return visible;
}
/** Code-native template, rendered without scripts, foreignObject, images or external requests. */
export function marketingArt(
  campaign: Pick<MarketingCampaign, "headline" | "cta">,
) {
  const headline = campaign.headline.replace(/^Modelo editável:\s*/i, "");
  const title = wrap(headline, 24, 5)
    .map((line, i) => `<tspan x="100" y="${355 + i * 92}">${xml(line)}</tspan>`)
    .join("");
  const cta = wrap(campaign.cta, 40, 2)
    .map(
      (line, i) => `<tspan x="150" y="${1062 + i * 48}">${xml(line)}</tspan>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350" role="img" aria-label="Arte da campanha Web Fidelize">
<defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#edfaff"/><stop offset="1" stop-color="#d8f5ee"/></linearGradient><linearGradient id="accent"><stop stop-color="#007d89"/><stop offset="1" stop-color="#0f5165"/></linearGradient></defs>
<rect width="1080" height="1350" fill="url(#bg)"/>
<circle cx="1030" cy="120" r="270" fill="#00b6c3" opacity=".10"/><circle cx="1030" cy="120" r="180" fill="none" stroke="#00a8b7" stroke-width="2" opacity=".18"/>
<g font-family="Arial, Helvetica, sans-serif"><text x="100" y="142" font-size="54" font-weight="700" fill="#0b3041">Web<tspan fill="#007d89">fidelize</tspan></text>
<text x="100" y="230" font-size="22" font-weight="700" letter-spacing="3" fill="#336778">AGENDA · CLIENTES · EQUIPE</text>
<text font-size="76" font-weight="700" letter-spacing="-2" fill="#0b3041">${title}</text>
<rect x="100" y="825" width="880" height="125" rx="24" fill="#ffffff"/>
<text x="140" y="873" font-size="30" font-weight="700" fill="#0b3041">7 dias grátis no Essencial</text>
<text x="140" y="917" font-size="26" fill="#466570">1 profissional · sem cartão · sem cobrança automática</text>
<rect x="100" y="1000" width="880" height="150" rx="30" fill="url(#accent)"/>
<text font-size="34" font-weight="700" fill="#ffffff">${cta}</text>
<text x="100" y="1220" font-size="23" fill="#466570">Conheça os recursos e as condições:</text>
<text x="100" y="1262" font-size="25" font-weight="700" fill="#0b3041">webfidelize-saas.vercel.app</text></g></svg>`;
}
