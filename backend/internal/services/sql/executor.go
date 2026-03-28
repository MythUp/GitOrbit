// Purpose: Expose SQL execution entry points for direct DB mode or script-based remote mode.
package sql

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"net/url"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type Executor struct{}

func NewExecutor() *Executor {
	return &Executor{}
}

func (executor *Executor) ExecuteDirect(dsn, username, password, databaseName, script string) error {
	if strings.TrimSpace(dsn) == "" || strings.TrimSpace(script) == "" {
		return fmt.Errorf("invalid SQL request")
	}

	driver, connectionString, err := buildConnection(dsn, username, password, databaseName)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	database, err := sql.Open(driver, connectionString)
	if err != nil {
		return fmt.Errorf("open database connection: %w", err)
	}
	defer database.Close()

	if err := database.PingContext(ctx); err != nil {
		return fmt.Errorf("ping database: %w", err)
	}

	if _, err := database.ExecContext(ctx, script); err != nil {
		return fmt.Errorf("execute SQL script: %w", err)
	}

	return nil
}

func (executor *Executor) ExecuteViaRemoteScript(script string) error {
	if script == "" {
		return fmt.Errorf("missing SQL script")
	}

	// Placeholder for remote upload-and-execute flow (for PHP targets).
	return nil
}

func buildConnection(dsn, username, password, databaseName string) (string, string, error) {
	normalizedDSN := strings.TrimSpace(dsn)
	lowerDSN := strings.ToLower(normalizedDSN)

	if strings.HasPrefix(lowerDSN, "postgres://") || strings.HasPrefix(lowerDSN, "postgresql://") {
		parsed, err := url.Parse(normalizedDSN)
		if err != nil {
			return "", "", fmt.Errorf("parse postgres dsn: %w", err)
		}

		if strings.TrimSpace(username) != "" {
			if strings.TrimSpace(password) != "" {
				parsed.User = url.UserPassword(username, password)
			} else {
				parsed.User = url.User(username)
			}
		}

		if strings.TrimSpace(databaseName) != "" {
			parsed.Path = "/" + strings.TrimPrefix(strings.TrimSpace(databaseName), "/")
		}

		return "pgx", parsed.String(), nil
	}

	if strings.HasPrefix(lowerDSN, "mysql://") {
		parsed, err := url.Parse(normalizedDSN)
		if err != nil {
			return "", "", fmt.Errorf("parse mysql url dsn: %w", err)
		}

		cfg := mysql.NewConfig()
		cfg.Net = "tcp"
		cfg.Addr = parsed.Host
		cfg.User = parsed.User.Username()
		cfg.Passwd, _ = parsed.User.Password()
		cfg.DBName = strings.TrimPrefix(parsed.Path, "/")
		cfg.Params = map[string]string{"multiStatements": "true"}

		if strings.TrimSpace(username) != "" {
			cfg.User = username
		}
		if strings.TrimSpace(password) != "" {
			cfg.Passwd = password
		}
		if strings.TrimSpace(databaseName) != "" {
			cfg.DBName = databaseName
		}

		if cfg.Addr == "" {
			cfg.Addr = "127.0.0.1:3306"
		}

		return "mysql", cfg.FormatDSN(), nil
	}

	if strings.Contains(normalizedDSN, "@tcp(") || strings.Contains(normalizedDSN, "@unix(") {
		cfg, err := mysql.ParseDSN(normalizedDSN)
		if err != nil {
			return "", "", fmt.Errorf("parse mysql dsn: %w", err)
		}

		if strings.TrimSpace(username) != "" {
			cfg.User = username
		}
		if strings.TrimSpace(password) != "" {
			cfg.Passwd = password
		}
		if strings.TrimSpace(databaseName) != "" {
			cfg.DBName = databaseName
		}
		if cfg.Params == nil {
			cfg.Params = map[string]string{}
		}
		cfg.Params["multiStatements"] = "true"

		return "mysql", cfg.FormatDSN(), nil
	}

	if strings.Contains(normalizedDSN, "://") {
		return "", "", fmt.Errorf("unsupported SQL DSN format")
	}

	addr := normalizedDSN
	if addr == "" {
		addr = "127.0.0.1:3306"
	}

	if _, _, err := net.SplitHostPort(addr); err != nil {
		addr = net.JoinHostPort(addr, "3306")
	}

	cfg := mysql.NewConfig()
	cfg.Net = "tcp"
	cfg.Addr = addr
	cfg.User = strings.TrimSpace(username)
	cfg.Passwd = strings.TrimSpace(password)
	cfg.DBName = strings.TrimSpace(databaseName)
	cfg.Params = map[string]string{"multiStatements": "true"}

	if cfg.User == "" {
		return "", "", fmt.Errorf("sqlUsername is required for mysql connections")
	}

	return "mysql", cfg.FormatDSN(), nil
}
