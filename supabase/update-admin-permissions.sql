-- Update admin permissions to include customers module
UPDATE public.profiles
SET permissions = ARRAY[
  'dashboard','raw-materials','production','stock','pricing',
  'customers','sales','expenses','reconciliation',
  'personnel','reports','settings'
]
WHERE id = (SELECT id FROM auth.users WHERE email = 'papadomah@yahoo.co.uk' LIMIT 1);

-- Give existing non-admin users access to customers too
UPDATE public.profiles
SET permissions = array_append(permissions, 'customers')
WHERE role != 'admin'
  AND NOT ('customers' = ANY(permissions));

SELECT full_name, role, permissions FROM public.profiles;
