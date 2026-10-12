-- Executed only for an empty volume. Credentials are read from container env.
\getenv app_user SRL_APP_USER
\getenv app_password SRL_APP_PASSWORD
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER DATABASE stock_research_lab OWNER TO :"app_user";
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO :"app_user";
