package main

import (
	"log"
	"os"

	"github.com/shubhamprashar/anvil/internal/api"
	"github.com/shubhamprashar/anvil/internal/runner"
)

func main() {
	k6Path := os.Getenv("K6_PATH")
	if k6Path == "" {
		k6Path = "k6"
	}

	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = ":8080"
	}

	manager      := runner.New(k6Path)
	suiteManager := runner.NewSuiteManager(manager)
	server       := api.NewServer(manager, suiteManager)

	log.Fatal(server.ListenAndServe(addr))
}
