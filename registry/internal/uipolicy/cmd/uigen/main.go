// Command uigen writes the build stamp ui/build.stamp and the Rust table
// src/ui_assets.rs of the Registry Web UI (package uipolicy) and then runs
// the checks of the gate. ui/build.sh runs it after the npm build; run from
// oec/registry:
//
//	go run ./internal/uipolicy/cmd/uigen
package main

import (
	"fmt"
	"os"

	"github.com/OI4/oec/registry/internal/uipolicy"
)

func main() {
	if err := uipolicy.Write("ui", "."); err != nil {
		fmt.Fprintln(os.Stderr, "uigen:", err)
		os.Exit(1)
	}
	pkgs, errs := uipolicy.CheckPackages("ui")
	errs = append(errs, uipolicy.Check("ui", ".")...)
	for _, err := range errs {
		fmt.Fprintln(os.Stderr, "uigen:", err)
	}
	if len(errs) > 0 {
		os.Exit(1)
	}
	shipped := 0
	for _, p := range pkgs {
		if p.Shipped {
			shipped++
		}
	}
	fmt.Printf("uigen: %s and %s written; %d packages in the lockfile, %d shipped\n",
		"ui/"+uipolicy.StampFile, uipolicy.TableFile, len(pkgs), shipped)
}
