# ── Stage 1: build the Go binary ─────────────────────────────
FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /anvil-server ./cmd/server


# ── Stage 2: build k6 with xk6 ───────────────────────────────
# xk6-kafka v1.3.0 requires Go 1.26 — too new. We pin to v1.2.0 which
# was released Dec 2024 and targets k6 v1.4.2 with Go <=1.25.
# GOTOOLCHAIN=local prevents Go from auto-downloading a newer toolchain
# when it sees a module with a higher go/toolchain directive.
# Redis is built-in to k6 via k6/experimental/redis — no extension needed.
FROM golang:1.25-alpine AS k6builder

RUN apk add --no-cache git ca-certificates

ENV GOTOOLCHAIN=local

RUN go install go.k6.io/xk6/cmd/xk6@latest

RUN xk6 build v1.4.2 \
    --with github.com/mostafa/xk6-kafka@v1.2.0 \
    --output /k6


# ── Stage 3: minimal final image ─────────────────────────────
FROM alpine:3.19

RUN apk add --no-cache ca-certificates

COPY --from=k6builder /k6           /usr/bin/k6
COPY --from=builder   /anvil-server /usr/bin/anvil-server

ENV K6_PATH=/usr/bin/k6
ENV ADDR=:8080

EXPOSE 8080

CMD ["/usr/bin/anvil-server"]