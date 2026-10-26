BEGIN;

-- Most notes contain one complete JSON metadata block. Extract and validate it
-- using PostgreSQL's native parser rather than scanning every character in
-- PL/pgSQL each time the board calculates assignments, status and phase readiness.
-- Retain the original scanner for ambiguous notes, multiple metadata blocks,
-- trailing brace/bracket text and legacy blocks without their closing bracket.
CREATE OR REPLACE FUNCTION public.field_ops_site_metadata(_notes TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE raw TEXT; candidate TEXT; pos INT; start_pos INT; depth INT := 0;
  quoted BOOLEAN := false; escaped BOOLEAN := false; ch TEXT;
BEGIN
  pos := position('[METADATA:' IN coalesce(_notes,''));
  IF pos > 0 THEN
    start_pos := pos + length('[METADATA:');
    candidate := substring(substring(_notes,start_pos) FROM '^(\{.*\})\]');
    IF candidate IS NOT NULL THEN
      BEGIN
        RETURN candidate::jsonb;
      EXCEPTION WHEN invalid_text_representation THEN
        -- The greedy match can include later free-form notes. Fall back to the
        -- original quote-aware brace scanner to find the first metadata object.
        NULL;
      END;
    END IF;
    FOR pos IN start_pos..length(_notes) LOOP
      ch := substring(_notes,pos,1);
      IF escaped THEN escaped := false;
      ELSIF quoted AND ch = chr(92) THEN escaped := true;
      ELSIF ch = '"' THEN quoted := NOT quoted;
      ELSIF NOT quoted AND ch = '{' THEN depth := depth + 1;
      ELSIF NOT quoted AND ch = '}' THEN
        depth := depth - 1;
        IF depth = 0 THEN raw := substring(_notes,start_pos,pos-start_pos+1); EXIT; END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN coalesce(raw::jsonb,'{}'::jsonb);
EXCEPTION WHEN invalid_text_representation THEN RETURN '{}'::jsonb;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
