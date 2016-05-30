DO $$
    BEGIN
        BEGIN
            ALTER TABLE cd_events ADD COLUMN last_reminder_time timestamp;
        EXCEPTION
            WHEN duplicate_column THEN RAISE NOTICE 'column last_reminder_time already exists in cd_events.';
        END;
    END;
$$
