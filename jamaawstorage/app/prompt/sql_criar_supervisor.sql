-- Opcao 1: ativar um usuario ja existente no auth.users
-- Troque os valores abaixo e rode no SQL Editor.
SELECT public.activate_supervisor_profile(
  p_user_id => '00000000-0000-0000-0000-000000000000',
  p_full_name => 'Nome do Supervisor',
  p_employee_id => 'SUP-001',
  p_sector => 'Almoxarifado'
);

-- Opcao 2: criar a PRIMEIRA conta de supervisor sem depender de outro supervisor logado.
-- 1. Crie o usuario em Authentication > Users no painel do Supabase.
-- 2. Depois rode este UPDATE para ativar o perfil gerado pelo trigger.
/*
UPDATE public.profiles
SET
  full_name = 'Nome do Supervisor',
  employee_id = 'SUP-001',
  sector = 'Almoxarifado',
  role = 'supervisor',
  is_active = true,
  updated_at = now()
WHERE id = (
  SELECT id
  FROM auth.users
  WHERE email = 'supervisor@empresa.com'
);
*/
