// Purpose: Build safe SQL migration plans by diffing schema snapshots between two git refs.
package sql

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"launcher/backend/internal/models"
)

type MigrationPlanner struct{}

type schemaSnapshot struct {
	Tables map[string]schemaTable `json:"tables"`
}

type schemaTable struct {
	Columns map[string]schemaColumn `json:"columns"`
}

type schemaColumn struct {
	Type     string `json:"type"`
	Nullable bool   `json:"nullable"`
	Default  string `json:"default,omitempty"`
}

func NewMigrationPlanner() *MigrationPlanner {
	return &MigrationPlanner{}
}

func (planner *MigrationPlanner) BuildPlan(fromRef, toRef, schemaPath string, fromPayload, toPayload []byte) (models.SQLMigrationPlanResponse, error) {
	fromSnapshot, err := decodeSchemaSnapshot(fromPayload)
	if err != nil {
		return models.SQLMigrationPlanResponse{}, fmt.Errorf("decode from schema: %w", err)
	}

	toSnapshot, err := decodeSchemaSnapshot(toPayload)
	if err != nil {
		return models.SQLMigrationPlanResponse{}, fmt.Errorf("decode to schema: %w", err)
	}

	plan := models.SQLMigrationPlanResponse{
		FromRef:         fromRef,
		ToRef:           toRef,
		SchemaPath:      schemaPath,
		AddedTables:     []string{},
		RemovedTables:   []string{},
		AddedColumns:    []string{},
		RemovedColumns:  []string{},
		RenamedColumns:  []models.SQLColumnRename{},
		AlterStatements: []string{},
		Warnings:        []string{},
	}

	fromTables := sortedTableNames(fromSnapshot.Tables)
	toTables := sortedTableNames(toSnapshot.Tables)

	fromSet := make(map[string]struct{}, len(fromTables))
	for _, table := range fromTables {
		fromSet[table] = struct{}{}
	}

	toSet := make(map[string]struct{}, len(toTables))
	for _, table := range toTables {
		toSet[table] = struct{}{}
	}

	for _, table := range toTables {
		if _, exists := fromSet[table]; !exists {
			plan.AddedTables = append(plan.AddedTables, table)
			plan.Warnings = append(plan.Warnings, fmt.Sprintf("new table %s detected; create it before running app code", table))
		}
	}

	for _, table := range fromTables {
		if _, exists := toSet[table]; !exists {
			plan.RemovedTables = append(plan.RemovedTables, table)
			plan.Warnings = append(plan.Warnings, fmt.Sprintf("table %s no longer exists in target schema; review before dropping to avoid data loss", table))
		}
	}

	for _, table := range toTables {
		fromTable, inFrom := fromSnapshot.Tables[table]
		toTable, inTo := toSnapshot.Tables[table]
		if !inFrom || !inTo {
			continue
		}

		added, removed, shared := diffColumns(fromTable.Columns, toTable.Columns)
		consumedAdded := map[string]struct{}{}
		consumedRemoved := map[string]struct{}{}

		for _, removedColumn := range removed {
			removedDef := fromTable.Columns[removedColumn]
			removedSignature := columnSignature(removedDef)

			for _, addedColumn := range added {
				if _, used := consumedAdded[addedColumn]; used {
					continue
				}

				addedDef := toTable.Columns[addedColumn]
				if removedSignature != columnSignature(addedDef) {
					continue
				}

				consumedRemoved[removedColumn] = struct{}{}
				consumedAdded[addedColumn] = struct{}{}
				plan.RenamedColumns = append(plan.RenamedColumns, models.SQLColumnRename{
					Table:      table,
					FromColumn: removedColumn,
					ToColumn:   addedColumn,
				})
				plan.Warnings = append(plan.Warnings, fmt.Sprintf("possible rename detected: %s.%s -> %s", table, removedColumn, addedColumn))
				break
			}
		}

		for _, addedColumn := range added {
			if _, used := consumedAdded[addedColumn]; used {
				continue
			}

			addedDef := toTable.Columns[addedColumn]
			plan.AddedColumns = append(plan.AddedColumns, table+"."+addedColumn)
			plan.AlterStatements = append(plan.AlterStatements, buildAddColumnStatement(table, addedColumn, addedDef))
		}

		for _, removedColumn := range removed {
			if _, used := consumedRemoved[removedColumn]; used {
				continue
			}

			plan.RemovedColumns = append(plan.RemovedColumns, table+"."+removedColumn)
			plan.Warnings = append(plan.Warnings, fmt.Sprintf("column removed in target schema: %s.%s (manual migration required)", table, removedColumn))
		}

		for _, sharedColumn := range shared {
			fromDef := fromTable.Columns[sharedColumn]
			toDef := toTable.Columns[sharedColumn]
			if columnSignature(fromDef) == columnSignature(toDef) {
				continue
			}

			plan.Warnings = append(plan.Warnings, fmt.Sprintf("column definition changed: %s.%s (manual migration recommended)", table, sharedColumn))
		}
	}

	sort.Strings(plan.AddedTables)
	sort.Strings(plan.RemovedTables)
	sort.Strings(plan.AddedColumns)
	sort.Strings(plan.RemovedColumns)
	sort.Strings(plan.AlterStatements)
	sort.Strings(plan.Warnings)

	return plan, nil
}

func decodeSchemaSnapshot(payload []byte) (schemaSnapshot, error) {
	var snapshot schemaSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		return schemaSnapshot{}, err
	}

	if snapshot.Tables == nil {
		snapshot.Tables = map[string]schemaTable{}
	}

	for tableName, table := range snapshot.Tables {
		if table.Columns == nil {
			table.Columns = map[string]schemaColumn{}
			snapshot.Tables[tableName] = table
		}
	}

	return snapshot, nil
}

func sortedTableNames(tables map[string]schemaTable) []string {
	names := make([]string, 0, len(tables))
	for table := range tables {
		names = append(names, table)
	}

	sort.Strings(names)
	return names
}

func diffColumns(fromColumns, toColumns map[string]schemaColumn) (added, removed, shared []string) {
	fromNames := make([]string, 0, len(fromColumns))
	toNames := make([]string, 0, len(toColumns))

	for name := range fromColumns {
		fromNames = append(fromNames, name)
	}

	for name := range toColumns {
		toNames = append(toNames, name)
	}

	sort.Strings(fromNames)
	sort.Strings(toNames)

	fromSet := make(map[string]struct{}, len(fromNames))
	for _, name := range fromNames {
		fromSet[name] = struct{}{}
	}

	toSet := make(map[string]struct{}, len(toNames))
	for _, name := range toNames {
		toSet[name] = struct{}{}
	}

	for _, name := range toNames {
		if _, exists := fromSet[name]; exists {
			shared = append(shared, name)
			continue
		}
		added = append(added, name)
	}

	for _, name := range fromNames {
		if _, exists := toSet[name]; !exists {
			removed = append(removed, name)
		}
	}

	return added, removed, shared
}

func columnSignature(column schemaColumn) string {
	return strings.ToLower(strings.TrimSpace(column.Type)) + "|" + fmt.Sprintf("%t", column.Nullable) + "|" + strings.TrimSpace(column.Default)
}

func buildAddColumnStatement(table, column string, definition schemaColumn) string {
	statement := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", quoteIdent(table), quoteIdent(column), normalizeColumnType(definition.Type))
	if !definition.Nullable {
		statement += " NOT NULL"
	}
	if strings.TrimSpace(definition.Default) != "" {
		statement += " DEFAULT " + strings.TrimSpace(definition.Default)
	}
	statement += ";"
	return statement
}

func normalizeColumnType(columnType string) string {
	normalized := strings.TrimSpace(columnType)
	if normalized == "" {
		return "TEXT"
	}

	return normalized
}

func quoteIdent(identifier string) string {
	return `"` + strings.ReplaceAll(identifier, `"`, `""`) + `"`
}
