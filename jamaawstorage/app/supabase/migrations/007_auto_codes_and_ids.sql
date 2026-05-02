CREATE OR REPLACE FUNCTION public.normalize_identifier_text(input_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN regexp_replace(
    translate(
      lower(coalesce(input_text, '')),
      'áàãâäéèêëíìîïóòõôöúùûüçñ',
      'aaaaaeeeeiiiiooooouuuucn'
    ),
    '[^a-z0-9 ]',
    '',
    'g'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_stock_item_code(item_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  normalized_name TEXT;
  letters_only TEXT;
  consonants TEXT[] := ARRAY[]::TEXT[];
  fallback_letters TEXT[] := ARRAY[]::TEXT[];
  ch TEXT;
  idx INTEGER := 1;
  prefix TEXT := '';
  next_number INTEGER;
BEGIN
  normalized_name := public.normalize_identifier_text(item_name);
  letters_only := regexp_replace(normalized_name, '[^a-z]', '', 'g');

  IF letters_only = '' THEN
    letters_only := 'item';
  END IF;

  WHILE idx <= char_length(letters_only) LOOP
    ch := substr(letters_only, idx, 1);
    IF ch !~ '[aeiou]' AND array_position(consonants, ch) IS NULL THEN
      consonants := array_append(consonants, ch);
    END IF;
    IF array_position(fallback_letters, ch) IS NULL THEN
      fallback_letters := array_append(fallback_letters, ch);
    END IF;
    idx := idx + 1;
  END LOOP;

  FOREACH ch IN ARRAY consonants LOOP
    EXIT WHEN char_length(prefix) >= 3;
    prefix := prefix || ch;
  END LOOP;

  FOREACH ch IN ARRAY fallback_letters LOOP
    EXIT WHEN char_length(prefix) >= 3;
    IF position(ch IN prefix) = 0 THEN
      prefix := prefix || ch;
    END IF;
  END LOOP;

  prefix := upper(rpad(left(prefix, 3), 3, 'X'));

  SELECT coalesce(max(substring(code FROM '([0-9]+)$')::INTEGER), 0) + 1
  INTO next_number
  FROM public.stock_items
  WHERE code ~ ('^' || prefix || '-[0-9]+$');

  RETURN prefix || '-' || lpad(next_number::TEXT, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_prefixed_sequence(
  target_table TEXT,
  target_column TEXT,
  target_prefix TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  next_number INTEGER;
  sql TEXT;
BEGIN
  sql := format(
    'SELECT coalesce(max(substring(%1$I FROM ''([0-9]+)$'')::INTEGER), 0) + 1
       FROM public.%2$I
      WHERE %1$I ~ %3$L',
    target_column,
    target_table,
    '^' || target_prefix || '-[0-9]+$'
  );

  EXECUTE sql INTO next_number;

  RETURN target_prefix || '-' || lpad(next_number::TEXT, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.set_stock_item_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.code IS NULL OR btrim(NEW.code) = '' THEN
    NEW.code := public.generate_stock_item_code(NEW.name);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_profile_employee_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.employee_id IS NULL OR btrim(NEW.employee_id) = '' THEN
    NEW.employee_id := public.generate_prefixed_sequence('profiles', 'employee_id', 'MAT');
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_people_employee_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.employee_id IS NULL OR btrim(NEW.employee_id) = '' THEN
    NEW.employee_id := public.generate_prefixed_sequence('people', 'employee_id', 'JMW');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stock_items_auto_code_before_insert ON public.stock_items;
CREATE TRIGGER stock_items_auto_code_before_insert
BEFORE INSERT ON public.stock_items
FOR EACH ROW
EXECUTE FUNCTION public.set_stock_item_code();

DROP TRIGGER IF EXISTS profiles_auto_employee_id_before_insert ON public.profiles;
CREATE TRIGGER profiles_auto_employee_id_before_insert
BEFORE INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_profile_employee_id();

DROP TRIGGER IF EXISTS people_auto_employee_id_before_insert ON public.people;
CREATE TRIGGER people_auto_employee_id_before_insert
BEFORE INSERT ON public.people
FOR EACH ROW
EXECUTE FUNCTION public.set_people_employee_id();
