// Purpose: Provide SFTP deployment module placeholder to complete FTP/SFTP/SSH engine separation.
package deploy

import "fmt"

type SFTPEngine struct{}

func NewSFTPEngine() *SFTPEngine {
  return &SFTPEngine{}
}

func (engine *SFTPEngine) Deploy() error {
  return fmt.Errorf("sftp deployment implementation is pending")
}