import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { niches } from '@/lib/catalog';
import { createCompany } from './actions';
import { logout } from '@/app/auth/actions';
export const dynamic='force-dynamic';
export default async function Companies({searchParams}:{searchParams:Promise<{erro?:string}>}){
  const {db}=await requireUser();const p=await searchParams;
  const {data:companies,error}=await db.from('companies').select('id,name,niche');
  const {data:admin}=await db.rpc('is_super_admin');
  return <main><nav><Link className="brand" href="/">web<span>fidelize</span></Link><div className="links">{admin&&<Link href="/admin">Super admin</Link>}<form action={logout}><button className="secondary">Sair</button></form></div></nav><h1 style={{fontSize:40}}>Suas empresas</h1>{(p.erro||error)&&<div role="alert" className="notice error">Não foi possível concluir. Verifique suas permissões e a instalação do banco.</div>}<div className="grid">{companies?.map(c=><Link className="card" key={c.id} href={`/painel/${c.id}`}><h3>{c.name}</h3><span className="badge">Abrir painel →</span></Link>)}</div>{!companies?.length&&!error&&<p className="empty">Sua jornada começa aqui. Cadastre sua primeira empresa.</p>}<section className="panel auth"><h2>Criar empresa</h2><p>Seu trial de sete dias começa agora. O plano inicial permite um profissional.</p><form action={createCompany}><label htmlFor="name">Nome da empresa</label><input id="name" name="name" minLength={2} maxLength={100} required/><label htmlFor="niche">Segmento</label><select id="niche" name="niche">{niches.map(n=><option key={n.slug} value={n.slug}>{n.name}</option>)}</select><button>Criar e começar trial →</button></form></section></main>;
}
