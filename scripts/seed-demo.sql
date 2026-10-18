-- Only explicitly marked demonstration tenants. No passwords, real contacts or payment status.
do $$
declare n record; u uuid; c uuid; p uuid; s uuid; cust uuid; d date;begin
for n in select * from(values
 ('salao','Salão','Corte demonstrativo'),('pet-shop','Pet Shop','Banho demonstrativo'),('clinica','Clínica','Recepção demonstrativa'),('escritorio','Escritório','Reunião demonstrativa'),
 ('restaurante','Restaurante','Reserva demonstrativa'),('fornecedores','Fornecedores','Atendimento demonstrativo'),('logistica','Logística','Retirada demonstrativa'),('academia','Academia','Avaliação demonstrativa')
) as niches(slug,name,service_name) loop
 select id into u from auth.users where email=n.slug||'@example.invalid';
 if u is null then raise exception 'Provision demo Auth accounts first';end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 select id into c from public.companies where booking_slug='demo-'||n.slug and is_demo;
 if c is not null then continue;end if;
 c:=private.create_company('DEMO · '||n.name,n.slug);
 update public.companies set is_demo=true,booking_slug='demo-'||n.slug,booking_enabled=true,plan_id='empresarial' where id=c;
 insert into public.services(company_id,name,duration_minutes,price_cents) values(c,n.service_name||' (fictício)',30,5000) returning id into s;
 insert into public.services(company_id,name,duration_minutes,price_cents) values(c,'Atendimento estendido (fictício)',60,9000);
 insert into public.professionals(company_id,user_id,name) values(c,u,'Profissional DEMO 01') returning id into p;
 insert into public.professionals(company_id,name) values(c,'Profissional DEMO 02');
 insert into public.customers(company_id,name,phone) values(c,'Cliente fictício 01 — demonstração','11900000001') returning id into cust;
 insert into public.customers(company_id,name,phone) values(c,'Cliente fictício 02 — demonstração','11900000002');
 d:=(now() at time zone 'America/Sao_Paulo')::date+1;
 while extract(isodow from d)>5 loop d:=d+1;end loop;
 perform public.book_appointment(c,cust,s,p,(d::timestamp+time '09:00') at time zone 'America/Sao_Paulo');
end loop;
end $$;
