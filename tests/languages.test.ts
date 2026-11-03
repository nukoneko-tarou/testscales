import { describe, expect, it } from "@rstest/core";
import { classifyFile } from "../src/classifier/heuristics.js";

describe("Multi-language Test Classification (SOLID Open/Closed Architecture)", () => {
  describe("Python", () => {
    it("classifies Playwright/Selenium Python tests as E2E", () => {
      const code = `
        import pytest
        from playwright.sync_api import Page, expect

        def test_homepage(page: Page):
            page.goto("https://example.com")
            expect(page).to_have_title("Example")
      `;
      const res = classifyFile("tests/test_ui.py", code);
      expect(res.layer).toBe("e2e");
      expect(res.reasons).toContain("Python Playwright import");
    });

    it("classifies FastAPI / Django client tests as Integration", () => {
      const fastapi = `
        from fastapi.testclient import TestClient
        from myapp import app

        client = TestClient(app)

        def test_read_main():
            response = client.get("/")
            assert response.status_code == 200
      `;
      const res = classifyFile("tests/test_api.py", fastapi);
      expect(res.layer).toBe("integration");
      expect(res.reasons).toContain("FastAPI/Starlette TestClient integration");
    });

    it("classifies isolated mock tests as Unit", () => {
      const unit = `
        import unittest
        from unittest.mock import patch, MagicMock
        from myapp import calculate

        def test_compute():
            with patch("myapp.fetch_rate") as mock_fetch:
                mock_fetch.return_value = 1.5
                assert calculate(10) == 15
      `;
      const res = classifyFile("tests/test_calc.py", unit);
      expect(res.layer).toBe("unit");
      expect(res.reasons).toContain("Python mock isolation");
    });
  });

  describe("Go", () => {
    it("classifies chromedp / rod browser tests as E2E", () => {
      const code = `
        package test
        import (
            "testing"
            "github.com/chromedp/chromedp"
        )
        func TestBrowse(t *testing.T) {}
      `;
      const res = classifyFile("browse_test.go", code);
      expect(res.layer).toBe("e2e");
      expect(res.reasons).toContain("Go headless browser framework import");
    });

    it("classifies httptest and testcontainers as Integration", () => {
      const code = `
        package api_test
        import (
            "net/http/httptest"
            "testing"
        )
        func TestApi(t *testing.T) {
            req := httptest.NewRequest("GET", "/health", nil)
            rec := httptest.NewRecorder()
        }
      `;
      const res = classifyFile("api_test.go", code);
      expect(res.layer).toBe("integration");
      expect(res.reasons).toContain("Go net/http/httptest API integration");
    });

    it("classifies mock-isolated Go tests as Unit", () => {
      const code = `
        package service_test
        import (
            "testing"
            "github.com/golang/mock/gomock"
        )
        func TestLogic(t *testing.T) {}
      `;
      const res = classifyFile("logic_test.go", code);
      expect(res.layer).toBe("unit");
      expect(res.reasons).toContain("Go mock isolation framework");
    });
  });

  describe("Ruby", () => {
    it("classifies Rails system specs as E2E", () => {
      const code = `
        require 'rails_helper'
        RSpec.describe 'User login', type: :system do
          before do
            driven_by(:selenium_chrome_headless)
          end
          it 'logs in' do
            visit root_path
            fill_in 'Email', with: 'user@example.com'
          end
        end
      `;
      const res = classifyFile("spec/system/login_spec.rb", code);
      expect(res.layer).toBe("e2e");
      expect(res.reasons[0]).toContain("system");
    });

    it("classifies Rails request/api specs as Integration", () => {
      const code = `
        require 'rails_helper'
        RSpec.describe 'Users API', type: :request do
          it 'returns users list' do
            get '/api/v1/users', headers: { 'Accept' => 'application/json' }
            expect(response).to have_http_status(200)
          end
        end
      `;
      const res = classifyFile("spec/requests/users_spec.rb", code);
      expect(res.layer).toBe("integration");
      expect(res.reasons[0]).toContain("request");
    });

    it("classifies Rails model specs with test doubles as Unit", () => {
      const code = `
        require 'rails_helper'
        RSpec.describe User, type: :model do
          let(:gateway) { instance_double(PaymentGateway) }
          it 'validates email' do
            expect(user.valid?).to be true
          end
        end
      `;
      const res = classifyFile("spec/models/user_spec.rb", code);
      expect(res.layer).toBe("unit");
      expect(res.reasons[0]).toContain("model");
    });
  });
});

describe("JS/TS markers stay out of other languages", () => {
  it("does not read HTML in a Ruby string as JSX component rendering", () => {
    const code = `def test_link\n  assert_dom_equal %(<a href="/">Home</a>), link_to("Home", "/")\nend`;
    expect(classifyFile("actionview/test/template/url_helper_test.rb", code).layer).toBe("unit");
  });
});
