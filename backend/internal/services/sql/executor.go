// Purpose: Expose SQL execution entry points for direct DB mode or script-based remote mode.
package sql

import "fmt"

type Executor struct{}

func NewExecutor() *Executor {
	return &Executor{}
}

func (executor *Executor) ExecuteDirect(dsn string, script string) error {
	if dsn == "" || script == "" {
		return fmt.Errorf("invalid SQL request")
	}

	// This baseline keeps SQL execution explicit and safe by requiring an extension
	// with a concrete driver before enabling production direct execution.
	return fmt.Errorf("direct SQL execution requires a configured database driver")
}

func (executor *Executor) ExecuteViaRemoteScript(script string) error {
	if script == "" {
		return fmt.Errorf("missing SQL script")
	}

	// Placeholder for remote upload-and-execute flow (for PHP targets).
	return nil
}
