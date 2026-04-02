package main

import (
	"log"
	"os"

	"github.com/shubhamprashar/anvil/internal/api"
	"github.com/shubhamprashar/anvil/internal/llm"
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

	// LLM summarizer — nil when LLM_PROVIDER is unset (feature disabled)
	summarizer, err := llm.New(llm.FromEnv())
	if err != nil {
		log.Fatalf("LLM config error: %v", err)
	}
	if summarizer != nil {
		log.Printf("LLM enabled: provider=%s model=%s", summarizer.Provider(), summarizer.Model())
	} else {
		log.Println("LLM disabled (set LLM_PROVIDER to enable AI summaries)")
	}

	manager := runner.New(k6Path)
	suiteManager := runner.NewSuiteManager(manager)
	server := api.NewServer(manager, suiteManager, summarizer)

	log.Fatal(server.ListenAndServe(addr))
}
