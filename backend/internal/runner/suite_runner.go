package runner

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/shubhamprashar/anvil/internal/models"
)

// ── SuiteRun (live state) ─────────────────────────────────────

// liveSuiteRun tracks a suite execution in memory.
type liveSuiteRun struct {
	models.SuiteRun

	mu          sync.RWMutex
	subscribers []chan models.SuiteEvent
}

func (sr *liveSuiteRun) getNodeRun(nodeID string) *models.SuiteNodeRun {
	sr.mu.RLock()
	defer sr.mu.RUnlock()
	for i := range sr.NodeRuns {
		if sr.NodeRuns[i].NodeID == nodeID {
			return &sr.NodeRuns[i]
		}
	}
	return nil
}

func (sr *liveSuiteRun) setNodeStatus(nodeID string, status models.RunStatus, runID, errMsg string) {
	sr.mu.Lock()
	for i := range sr.NodeRuns {
		if sr.NodeRuns[i].NodeID == nodeID {
			sr.NodeRuns[i].Status = status
			if runID != "" {
				sr.NodeRuns[i].RunID = runID
			}
			if errMsg != "" {
				sr.NodeRuns[i].Error = errMsg
			}
			break
		}
	}
	nr := sr.getNodeRunLocked(nodeID)
	sr.mu.Unlock()

	if nr != nil {
		sr.broadcast(models.SuiteEvent{Type: "node_update", NodeRun: nr})
	}
}

// getNodeRunLocked must be called with mu held.
func (sr *liveSuiteRun) getNodeRunLocked(nodeID string) *models.SuiteNodeRun {
	for i := range sr.NodeRuns {
		if sr.NodeRuns[i].NodeID == nodeID {
			copy := sr.NodeRuns[i]
			return &copy
		}
	}
	return nil
}

func (sr *liveSuiteRun) broadcast(e models.SuiteEvent) {
	sr.mu.Lock()
	defer sr.mu.Unlock()
	for _, ch := range sr.subscribers {
		select {
		case ch <- e:
		default:
		}
	}
}

func (sr *liveSuiteRun) subscribe() chan models.SuiteEvent {
	ch := make(chan models.SuiteEvent, 256)
	sr.mu.Lock()
	defer sr.mu.Unlock()
	if sr.Status == models.StatusCompleted || sr.Status == models.StatusFailed {
		close(ch)
		return ch
	}
	sr.subscribers = append(sr.subscribers, ch)
	return ch
}

func (sr *liveSuiteRun) unsubscribe(ch chan models.SuiteEvent) {
	sr.mu.Lock()
	defer sr.mu.Unlock()
	for i, s := range sr.subscribers {
		if s == ch {
			sr.subscribers = append(sr.subscribers[:i], sr.subscribers[i+1:]...)
			close(ch)
			return
		}
	}
}

func (sr *liveSuiteRun) finish(status models.RunStatus, errMsg string) {
	now := time.Now()
	sr.mu.Lock()
	sr.Status = status
	sr.CompletedAt = &now
	for _, ch := range sr.subscribers {
		close(ch)
	}
	sr.subscribers = nil
	sr.mu.Unlock()
	_ = errMsg
}

// ── SuiteManager ──────────────────────────────────────────────

// SuiteManager orchestrates suite executions on top of the run Manager.
type SuiteManager struct {
	runs    sync.Map // map[string]*liveSuiteRun
	manager *Manager // for individual test runs
}

// NewSuiteManager creates a SuiteManager backed by the given run Manager.
func NewSuiteManager(m *Manager) *SuiteManager {
	return &SuiteManager{manager: m}
}

// StartSuite validates, then asynchronously executes the DAG.
// Returns the suite run ID immediately.
func (sm *SuiteManager) StartSuite(ctx context.Context, suite models.Suite) (string, error) {
	if len(suite.Nodes) == 0 {
		return "", fmt.Errorf("suite must have at least one node")
	}
	if err := validateDAG(suite); err != nil {
		return "", fmt.Errorf("invalid suite DAG: %w", err)
	}

	id := fmt.Sprintf("suite-%d", time.Now().UnixNano())

	nodeRuns := make([]models.SuiteNodeRun, len(suite.Nodes))
	for i, n := range suite.Nodes {
		nodeRuns[i] = models.SuiteNodeRun{NodeID: n.ID, Status: models.StatusPending}
	}

	sr := &liveSuiteRun{
		SuiteRun: models.SuiteRun{
			ID:        id,
			Suite:     suite,
			Status:    models.StatusRunning,
			NodeRuns:  nodeRuns,
			StartedAt: time.Now(),
		},
	}
	sm.runs.Store(id, sr)

	go sm.execute(ctx, sr)
	return id, nil
}

// GetSuiteRun returns a snapshot of the suite run, or nil if not found.
func (sm *SuiteManager) GetSuiteRun(id string) *models.SuiteRun {
	v, ok := sm.runs.Load(id)
	if !ok {
		return nil
	}
	sr := v.(*liveSuiteRun)
	sr.mu.RLock()
	defer sr.mu.RUnlock()
	snap := sr.SuiteRun // value copy
	return &snap
}

// SubscribeSuite returns a channel of SuiteEvents for the given suite run.
func (sm *SuiteManager) SubscribeSuite(id string) chan models.SuiteEvent {
	v, ok := sm.runs.Load(id)
	if !ok {
		return nil
	}
	return v.(*liveSuiteRun).subscribe()
}

// UnsubscribeSuite removes a subscriber.
func (sm *SuiteManager) UnsubscribeSuite(id string, ch chan models.SuiteEvent) {
	v, ok := sm.runs.Load(id)
	if !ok {
		return
	}
	v.(*liveSuiteRun).unsubscribe(ch)
}

// ── DAG execution ─────────────────────────────────────────────

// execute runs the suite DAG: find runnable nodes, execute them concurrently,
// handle gate failures by skipping reachable dependents.
func (sm *SuiteManager) execute(ctx context.Context, sr *liveSuiteRun) {
	nodes := sr.Suite.Nodes
	nodeByID := make(map[string]*models.SuiteNode, len(nodes))
	for i := range nodes {
		nodeByID[nodes[i].ID] = &nodes[i]
	}

	// Track which nodes have been resolved (completed or skipped or failed).
	resolved := make(map[string]bool)
	// Track failed gate nodes to compute downstream skip sets.
	failedGates := make(map[string]bool)

	var mu sync.Mutex // guards resolved, failedGates

	// isRunnable returns true when all dependencies are completed (not failed/skipped).
	isRunnable := func(n *models.SuiteNode) bool {
		for _, dep := range n.Dependencies {
			nr := sr.getNodeRun(dep)
			if nr == nil || nr.Status != models.StatusCompleted {
				return false
			}
		}
		return true
	}

	// isSkipped returns true if any dependency was skipped or a gate dependency failed.
	isSkipped := func(n *models.SuiteNode) bool {
		for _, dep := range n.Dependencies {
			nr := sr.getNodeRun(dep)
			if nr == nil {
				continue
			}
			if nr.Status == models.StatusSkipped {
				return true
			}
			if nr.Status == models.StatusFailed && failedGates[dep] {
				return true
			}
		}
		return false
	}

	for {
		// Find all nodes that are ready to run in this iteration.
		var wave []*models.SuiteNode
		mu.Lock()
		for i := range nodes {
			n := &nodes[i]
			if resolved[n.ID] {
				continue
			}
			if isSkipped(n) {
				sr.setNodeStatus(n.ID, models.StatusSkipped, "", "upstream gate failed")
				resolved[n.ID] = true
				continue
			}
			if isRunnable(n) {
				wave = append(wave, n)
				resolved[n.ID] = true // mark as "claimed" to avoid double-scheduling
			}
		}
		mu.Unlock()

		if len(wave) == 0 {
			break // no more nodes can be scheduled
		}

		// Run this wave concurrently.
		var wg sync.WaitGroup
		for _, n := range wave {
			wg.Add(1)
			go func(node *models.SuiteNode) {
				defer wg.Done()
				sm.runNode(ctx, sr, node, &mu, failedGates)
			}(n)
		}
		wg.Wait()
	}

	// Determine overall suite status.
	suiteStatus := models.StatusCompleted
	sr.mu.RLock()
	for _, nr := range sr.NodeRuns {
		if nr.Status == models.StatusFailed {
			suiteStatus = models.StatusFailed
			break
		}
	}
	sr.mu.RUnlock()

	sr.finish(suiteStatus, "")
	sr.broadcast(models.SuiteEvent{Type: "suite_done", Status: suiteStatus})
}

// runNode starts a single k6 test run for a suite node and waits for it to complete.
func (sm *SuiteManager) runNode(
	ctx context.Context,
	sr *liveSuiteRun,
	node *models.SuiteNode,
	mu *sync.Mutex,
	failedGates map[string]bool,
) {
	sr.setNodeStatus(node.ID, models.StatusRunning, "", "")

	runID, err := sm.manager.Start(ctx, node.TestConfig)
	if err != nil {
		sr.setNodeStatus(node.ID, models.StatusFailed, "", err.Error())
		if node.IsGate {
			mu.Lock()
			failedGates[node.ID] = true
			mu.Unlock()
		}
		return
	}
	sr.setNodeStatus(node.ID, models.StatusRunning, runID, "")

	// Poll the run until it finishes.
	ch := sm.manager.Subscribe(runID)
	if ch != nil {
		for range ch {
			// drain log lines — we don't forward them to the suite stream
		}
	}

	run := sm.manager.Get(runID)

	// A node is considered failed if:
	// 1. The run itself failed (k6 exited non-zero / threshold breach), OR
	// 2. The HTTP error rate is 100% — all requests failed (e.g. bad URL), even
	//    though k6 exited cleanly because no threshold was configured.
	nodeActuallyFailed := func() (bool, string) {
		if run == nil {
			return true, "run not found"
		}
		if run.Status == models.StatusFailed {
			return true, run.Error
		}
		if run.Metrics != nil && run.Metrics.HTTPReqFailed.Rate >= 1.0 {
			return true, fmt.Sprintf("100%% of HTTP requests failed (check your URL or endpoint)")
		}
		return false, ""
	}

	if failed, errMsg := nodeActuallyFailed(); failed {
		sr.setNodeStatus(node.ID, models.StatusFailed, runID, errMsg)
		if node.IsGate {
			mu.Lock()
			failedGates[node.ID] = true
			mu.Unlock()
		}
		return
	}

	sr.setNodeStatus(node.ID, models.StatusCompleted, runID, "")
}

// ── DAG validation ────────────────────────────────────────────

// validateDAG checks for unknown dependency references and cycles.
func validateDAG(suite models.Suite) error {
	ids := make(map[string]bool, len(suite.Nodes))
	for _, n := range suite.Nodes {
		ids[n.ID] = true
	}
	for _, n := range suite.Nodes {
		for _, dep := range n.Dependencies {
			if !ids[dep] {
				return fmt.Errorf("node %q references unknown dependency %q", n.ID, dep)
			}
		}
	}
	// Kahn's algorithm for cycle detection.
	inDegree := make(map[string]int, len(suite.Nodes))
	adj := make(map[string][]string)
	for _, n := range suite.Nodes {
		inDegree[n.ID] = len(n.Dependencies)
		for _, dep := range n.Dependencies {
			adj[dep] = append(adj[dep], n.ID)
		}
	}
	queue := []string{}
	for _, n := range suite.Nodes {
		if inDegree[n.ID] == 0 {
			queue = append(queue, n.ID)
		}
	}
	visited := 0
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		visited++
		for _, next := range adj[cur] {
			inDegree[next]--
			if inDegree[next] == 0 {
				queue = append(queue, next)
			}
		}
	}
	if visited != len(suite.Nodes) {
		return fmt.Errorf("dependency cycle detected")
	}
	return nil
}

// MarshalSuiteEvent serialises a SuiteEvent to JSON (used in SSE handler).
func MarshalSuiteEvent(e models.SuiteEvent) string {
	b, _ := json.Marshal(e)
	return string(b)
}
