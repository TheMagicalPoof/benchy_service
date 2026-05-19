package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"google.golang.org/api/option"
	"google.golang.org/api/sheets/v4"
)

const defaultSheetID = "1f_GUmwxygxnrWOIyYB9M3BzhK3e7VsP9tTR5gjsECTU"

type config struct {
	Addr               string
	SheetID            string
	CredentialsFile    string
	CredentialsJSON    string
	WriteToken         string
	AllowedOrigins     map[string]bool
	AllowMissingOrigin bool
}

type app struct {
	config config
	sheets *sheets.Service
}

type materialResponse struct {
	FDM []FDMMaterial `json:"fdm"`
	SLA []SLAMaterial `json:"sla"`
}

type FDMMaterial struct {
	Name                 string  `json:"name"`
	Done                 bool    `json:"done"`
	PriceRub             float64 `json:"priceRub"`
	SpoolWeightG         float64 `json:"spoolWeightG"`
	WasteRatio           float64 `json:"wasteRatio"`
	CostPerGram          float64 `json:"costPerGram"`
	CostPerGramWithWaste float64 `json:"costPerGramWithWaste"`
	DensityGPerCm3       float64 `json:"densityGPerCm3"`
}

type SLAMaterial struct {
	Name           string  `json:"name"`
	Done           bool    `json:"done"`
	PriceRub       float64 `json:"priceRub"`
	CapacityMl     float64 `json:"capacityMl"`
	DensityGPerCm3 float64 `json:"densityGPerCm3"`
	WasteRatio     float64 `json:"wasteRatio"`
	CostPerMl      float64 `json:"costPerMl"`
}

type FDMOrderRequest struct {
	Date          string  `json:"date"`
	Name          string  `json:"name"`
	Quantity      int     `json:"quantity"`
	Customer      string  `json:"customer"`
	Files         string  `json:"files"`
	Note          string  `json:"note"`
	Address       string  `json:"address"`
	Plastic       string  `json:"plastic"`
	VolumeCm3     float64 `json:"volumeCm3"`
	ActualWeightG float64 `json:"actualWeightG"`
	PrintTimeH    float64 `json:"printTimeH"`
	SalePriceRub  float64 `json:"salePriceRub"`
}

type orderResponse struct {
	OK                bool    `json:"ok"`
	Range             string  `json:"range,omitempty"`
	CalculatedWeightG float64 `json:"calculatedWeightG,omitempty"`
	DensityGPerCm3    float64 `json:"densityGPerCm3,omitempty"`
	WasteRatio        float64 `json:"wasteRatio,omitempty"`
}

func main() {
	ctx := context.Background()
	cfg := loadConfig()

	service, err := newSheetsService(ctx, cfg)
	if err != nil {
		log.Fatalf("google sheets init failed: %v", err)
	}

	server := &app{config: cfg, sheets: service}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", server.handleHealth)
	mux.HandleFunc("GET /api/pricing", server.handlePricing)
	mux.HandleFunc("POST /api/orders/fdm", server.handleCreateFDMOrder)

	log.Printf("backend listening on %s", cfg.Addr)
	log.Fatal(http.ListenAndServe(cfg.Addr, server.withCORS(mux)))
}

func loadConfig() config {
	addr := getenv("HTTP_ADDR", ":8080")
	origins := map[string]bool{}
	for _, origin := range strings.Split(getenv("FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:5175"), ",") {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			origins[origin] = true
		}
	}

	return config{
		Addr:               addr,
		SheetID:            getenv("GOOGLE_SHEETS_ID", defaultSheetID),
		CredentialsFile:    os.Getenv("GOOGLE_APPLICATION_CREDENTIALS"),
		CredentialsJSON:    os.Getenv("GOOGLE_SERVICE_ACCOUNT_JSON"),
		WriteToken:         os.Getenv("SHEET_WRITE_TOKEN"),
		AllowedOrigins:     origins,
		AllowMissingOrigin: os.Getenv("ALLOW_MISSING_ORIGIN") == "1",
	}
}

func newSheetsService(ctx context.Context, cfg config) (*sheets.Service, error) {
	options := []option.ClientOption{option.WithScopes(sheets.SpreadsheetsScope)}
	switch {
	case cfg.CredentialsJSON != "":
		options = append(options, option.WithCredentialsJSON([]byte(cfg.CredentialsJSON)))
	case cfg.CredentialsFile != "":
		options = append(options, option.WithCredentialsFile(cfg.CredentialsFile))
	default:
		return nil, errors.New("set GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_SERVICE_ACCOUNT_JSON")
	}

	return sheets.NewService(ctx, options...)
}

func (a *app) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && a.config.AllowedOrigins[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Write-Token")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		if origin != "" && !a.config.AllowedOrigins[origin] {
			writeError(w, http.StatusForbidden, "origin is not allowed")
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (a *app) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *app) handlePricing(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	fdmRows, err := a.readValues(ctx, "Материал FDM!A1:J100")
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	slaRows, err := a.readValues(ctx, "Материал SLA!A1:P100")
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, materialResponse{
		FDM: parseFDMMaterials(fdmRows),
		SLA: parseSLAMaterials(slaRows),
	})
}

func (a *app) handleCreateFDMOrder(w http.ResponseWriter, r *http.Request) {
	if a.config.WriteToken == "" {
		writeError(w, http.StatusServiceUnavailable, "SHEET_WRITE_TOKEN is not configured")
		return
	}
	if r.Header.Get("X-Write-Token") != a.config.WriteToken {
		writeError(w, http.StatusUnauthorized, "invalid write token")
		return
	}

	var req FDMOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Quantity <= 0 {
		req.Quantity = 1
	}
	if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.Plastic) == "" {
		writeError(w, http.StatusBadRequest, "name and plastic are required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	materials, err := a.fdmMaterialMap(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	material, ok := materials[req.Plastic]
	if !ok {
		writeError(w, http.StatusBadRequest, "unknown FDM material")
		return
	}

	calculatedWeight := round1(req.VolumeCm3 * material.DensityGPerCm3 * (1 + material.WasteRatio))
	nextRow, err := a.nextOrderRow(ctx, "Заказы FDM!A:A")
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	date := req.Date
	if date == "" {
		date = time.Now().Format("02.01.2006")
	}

	row := []any{
		date,
		req.Name,
		req.Quantity,
		req.Customer,
		req.Files,
		req.Note,
		req.Address,
		req.Plastic,
		calculatedWeight,
		emptyIfZero(req.ActualWeightG),
		emptyIfZero(req.PrintTimeH),
		"",
		emptyIfZero(req.SalePriceRub),
		"",
		false,
		false,
		false,
		"",
		emptyIfZero(req.VolumeCm3),
		material.DensityGPerCm3,
		material.WasteRatio,
		fmt.Sprintf("=IF(OR($S%d=\"\";$T%d=\"\";$U%d=\"\");\"\";ROUND($S%d*$T%d*(1+$U%d);1))", nextRow, nextRow, nextRow, nextRow, nextRow, nextRow),
	}

	resp, err := a.sheets.Spreadsheets.Values.Append(a.config.SheetID, "Заказы FDM!A:V", &sheets.ValueRange{
		MajorDimension: "ROWS",
		Values:         [][]any{row},
	}).ValueInputOption("USER_ENTERED").InsertDataOption("INSERT_ROWS").Context(ctx).Do()
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, orderResponse{
		OK:                true,
		Range:             resp.Updates.UpdatedRange,
		CalculatedWeightG: calculatedWeight,
		DensityGPerCm3:    material.DensityGPerCm3,
		WasteRatio:        material.WasteRatio,
	})
}

func (a *app) readValues(ctx context.Context, rangeName string) ([][]any, error) {
	resp, err := a.sheets.Spreadsheets.Values.Get(a.config.SheetID, rangeName).Context(ctx).Do()
	if err != nil {
		return nil, err
	}
	return resp.Values, nil
}

func (a *app) fdmMaterialMap(ctx context.Context) (map[string]FDMMaterial, error) {
	rows, err := a.readValues(ctx, "Материал FDM!A1:J100")
	if err != nil {
		return nil, err
	}

	materials := map[string]FDMMaterial{}
	for _, material := range parseFDMMaterials(rows) {
		materials[material.Name] = material
	}
	return materials, nil
}

func (a *app) nextOrderRow(ctx context.Context, rangeName string) (int, error) {
	rows, err := a.readValues(ctx, rangeName)
	if err != nil {
		return 0, err
	}
	return len(rows) + 1, nil
}

func parseFDMMaterials(rows [][]any) []FDMMaterial {
	var materials []FDMMaterial
	for _, row := range rows[1:] {
		name := cell(row, 1)
		if name == "" {
			continue
		}

		price := parseNumber(cell(row, 2))
		spoolWeight := parseNumber(cell(row, 3))
		waste := parsePercent(cell(row, 4))
		costPerGram := parseNumber(cell(row, 5))
		density := parseNumber(cell(row, 9))
		if costPerGram == 0 && spoolWeight > 0 {
			costPerGram = price / spoolWeight
		}

		materials = append(materials, FDMMaterial{
			Name:                 name,
			Done:                 parseBool(cell(row, 0)),
			PriceRub:             price,
			SpoolWeightG:         spoolWeight,
			WasteRatio:           waste,
			CostPerGram:          costPerGram,
			CostPerGramWithWaste: costPerGram,
			DensityGPerCm3:       density,
		})
	}
	return materials
}

func parseSLAMaterials(rows [][]any) []SLAMaterial {
	var materials []SLAMaterial
	for _, row := range rows[1:] {
		name := cell(row, 1)
		if name == "" {
			continue
		}

		materials = append(materials, SLAMaterial{
			Name:           name,
			Done:           parseBool(cell(row, 0)),
			PriceRub:       parseNumber(cell(row, 2)),
			CapacityMl:     parseNumber(cell(row, 3)),
			DensityGPerCm3: parseNumber(cell(row, 4)),
			WasteRatio:     parsePercent(cell(row, 5)),
			CostPerMl:      parseNumber(cell(row, 6)),
		})
	}
	return materials
}

func cell(row []any, index int) string {
	if index >= len(row) || row[index] == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(row[index]))
}

func parseBool(value string) bool {
	return strings.EqualFold(strings.TrimSpace(value), "true")
}

func parsePercent(value string) float64 {
	number := parseNumber(value)
	if number > 1 {
		return number / 100
	}
	return number
}

func parseNumber(value string) float64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}

	replacer := strings.NewReplacer(
		" ", "",
		"\u00a0", "",
		"р.", "",
		"p.", "",
		"руб.", "",
		"гр.", "",
		"г/см3", "",
		"г/см3.", "",
		"мл.", "",
		"мл", "",
		"л.", "",
		"л", "",
		"%", "",
		",", ".",
	)
	value = replacer.Replace(value)

	number, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0
	}
	return number
}

func round1(value float64) float64 {
	return math.Round(value*10) / 10
}

func emptyIfZero(value float64) any {
	if value == 0 {
		return ""
	}
	return value
}

func getenv(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{
		"ok":    false,
		"error": message,
	})
}
