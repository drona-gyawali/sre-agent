import type { ToolArguments } from "../../../mcp/mcp.interface";
import type { IntegrationType } from "../../datasource.types";

export interface SqlDiscoveryQueries {
  readonly tables: string;
  readonly columns: string;
}

export interface SqlDialect {
  readonly type: IntegrationType;
  readonly label: string;
  describeTableArguments(tableName: string): ToolArguments;
  readonly discovery?: SqlDiscoveryQueries;
}

export const SQLITE_DIALECT: SqlDialect = Object.freeze({
  type: "sqlite",
  label: "SQLite",
  describeTableArguments: (tableName: string) => ({ tableName }),
});

export const POSTGRES_DIALECT: SqlDialect = Object.freeze({
  type: "postgres",
  label: "PostgreSQL",
  describeTableArguments: (tableName: string) => ({ table_name: tableName }),
  discovery: {
    tables: `SELECT table_name AS name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name`,
    columns: `SELECT
  c.table_name AS table_name,
  c.column_name AS name,
  c.data_type AS type,
  (c.is_nullable = 'NO') AS not_null,
  EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = c.table_schema
      AND tc.table_name = c.table_name
      AND kcu.column_name = c.column_name
  ) AS pk,
  c.column_default AS default_value
FROM information_schema.columns c
WHERE c.table_schema = 'public'
ORDER BY c.table_name, c.ordinal_position`,
  },
});
