import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
export async function GET(request:NextRequest){
  const code=request.nextUrl.searchParams.get('code');
  const next=request.nextUrl.searchParams.get('next')==='/nova-senha'?'/nova-senha':'/painel';
  if(code){const db=await createClient();const {error}=await db.auth.exchangeCodeForSession(code);if(!error)return NextResponse.redirect(new URL(next,request.url));}
  return NextResponse.redirect(new URL('/entrar?erro=link',request.url));
}
