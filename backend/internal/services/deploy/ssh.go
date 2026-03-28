// Purpose: Offer optional SSH deployment primitives (git pull, checkout, and command execution).
package deploy

import (
	"bytes"
	"fmt"
	"net"
	"time"

	"golang.org/x/crypto/ssh"
)

type SSHEngine struct{}

func NewSSHEngine() *SSHEngine {
	return &SSHEngine{}
}

func (engine *SSHEngine) RunCommand(host string, port int, username, password, command string) (string, error) {
	config := &ssh.ClientConfig{
		User:            username,
		Auth:            []ssh.AuthMethod{ssh.Password(password)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         15 * time.Second,
	}

	client, err := ssh.Dial("tcp", net.JoinHostPort(host, fmt.Sprintf("%d", port)), config)
	if err != nil {
		return "", fmt.Errorf("dial ssh: %w", err)
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("create session: %w", err)
	}
	defer session.Close()

	var stdout bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stdout

	if err := session.Run(command); err != nil {
		return stdout.String(), fmt.Errorf("run command: %w", err)
	}

	return stdout.String(), nil
}
