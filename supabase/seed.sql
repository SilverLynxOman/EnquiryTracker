-- Sales persons found in the 2026 register (imports also create missing ones automatically).
insert into public.sales_persons (name) values
  ('ALI SIR'), ('ANWAR'), ('ASHWIN'), ('AYAN'), ('FAHAD'), ('FIDA'), ('HAIDER'), ('HASHIF'),
  ('JITTU'), ('KHURRAM'), ('MAHMUD'), ('MALIK'), ('MARIA'), ('PRASAD'), ('RAHEEL'), ('RAJESH'),
  ('RASHID'), ('SAHAN'), ('SHIYAD'), ('SOWBHAGYA'), ('VIVEK'), ('WAHEED'), ('WAQAS')
on conflict (name_key) do nothing;
