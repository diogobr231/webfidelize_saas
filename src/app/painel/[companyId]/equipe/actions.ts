'use server';
import { redirect } from 'next/navigation';
import { requireCompany } from '@/lib/auth';
import { z } from 'zod';
export async function invite(form:FormData){
  const parsed=z.object({company_id:z.uuid(),email:z.email().max(254),role:z.enum(['MANAGER','EMPLOYEE'])}).safeParse(Object.fromEntries(form));
  if(!parsed.success)redirect('/painel');
  const {db,role}=await requireCompany(parsed.data.company_id,true);if(role!=='OWNER')redirect('/painel');
  const {data,error}=await db.rpc('invite_member',{c:parsed.data.company_id,e:parsed.data.email,r:parsed.data.role});
  if(error)redirect(`/painel/${parsed.data.company_id}/equipe?erro=convite`);
  redirect(`/painel/${parsed.data.company_id}/equipe?convite=${data}`);
}
