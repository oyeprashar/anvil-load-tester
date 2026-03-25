# ── Stage 1: build the Go binary ─────────────────────────────
FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /anvil-server ./cmd/server

# ── Stage 2: final image with k6 + Go binary ─────────────────
# Grab the k6 binary from the official image
FROM grafana/k6:latest AS k6

# Minimal final image
FROM alpine:3.19

RUN apk add --no-cache ca-certificates

# Copy k6 binary
COPY --from=k6   /usr/bin/k6        /usr/bin/k6

# Copy Anvil server binary
COPY --from=builder /anvil-server   /usr/bin/anvil-server

ENV K6_PATH=/usr/bin/k6
ENV ADDR=:8080

EXPOSE 8080

CMD ["/usr/bin/anvil-server"]
