import { afterEach, beforeEach, describe, expect, it } from "@rstest/core";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyFile, countTestCases, detectFileLanguage } from "../src/classifier/heuristics.js";
import { detectConfigs } from "../src/scanner/config-detector.js";
import { isTestFile } from "../src/scanner/scanner.js";

describe("PHP Test Classification & Static Defense (Laravel, CakePHP, Symfony, Pest, PHPUnit)", () => {
  describe("Language Detection", () => {
    it("detects PHP language from .php extension", () => {
      expect(detectFileLanguage("tests/Feature/UserTest.php")).toBe("PHP");
      expect(detectFileLanguage("tests/Unit/MathTest.php")).toBe("PHP");
    });
  });

  describe("Laravel", () => {
    it("classifies Laravel Dusk browser tests as E2E", () => {
      const code = `<?php
namespace Tests\\Browser;

use Laravel\\Dusk\\Browser;
use Tests\\DuskTestCase;

class LoginTest extends DuskTestCase
{
    public function test_user_can_login(): void
    {
        $this->browse(function (Browser $browser) {
            $browser->visit('/login')
                    ->type('email', 'taylor@laravel.com')
                    ->press('Login')
                    ->assertPathIs('/home');
        });
    }
}
`;
      const res = classifyFile("tests/Browser/LoginTest.php", code);
      expect(res.layer).toBe("e2e");
      expect(res.language).toBe("PHP");
      expect(res.testCaseCount).toBe(1);
    });

    it("classifies Laravel Feature tests (HTTP & DB) as Integration", () => {
      const code = `<?php
namespace Tests\\Feature;

use Illuminate\\Foundation\\Testing\\RefreshDatabase;
use Tests\\TestCase;

class UserApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_can_fetch_users(): void
    {
        $response = $this->getJson('/api/users');
        $response->assertStatus(200);
        $this->assertDatabaseHas('users', ['id' => 1]);
    }
}
`;
      const res = classifyFile("tests/Feature/UserApiTest.php", code);
      expect(res.layer).toBe("integration");
      expect(res.language).toBe("PHP");
      expect(res.testCaseCount).toBe(1);
    });

    it("classifies Laravel Unit tests with mocks as Unit", () => {
      const code = `<?php
namespace Tests\\Unit;

use PHPUnit\\Framework\\TestCase;
use App\\Services\\BillingService;
use App\\Contracts\\PaymentGateway;

class BillingServiceTest extends TestCase
{
    public function test_charge_processes_payment(): void
    {
        $gateway = $this->createMock(PaymentGateway::class);
        $gateway->expects($this->once())
                ->method('charge')
                ->willReturn(true);

        $service = new BillingService($gateway);
        $this->assertTrue($service->pay(100));
    }
}
`;
      const res = classifyFile("tests/Unit/BillingServiceTest.php", code);
      expect(res.layer).toBe("unit");
      expect(res.language).toBe("PHP");
      expect(res.testCaseCount).toBe(1);
    });
  });

  describe("CakePHP (Pancake)", () => {
    it("classifies CakePHP controller integration tests as Integration", () => {
      const code = `<?php
namespace App\\Test\\TestCase\\Controller;

use Cake\\TestSuite\\IntegrationTestTrait;
use Cake\\TestSuite\\TestCase;

class ArticlesControllerTest extends TestCase
{
    use IntegrationTestTrait;

    public function testIndex(): void
    {
        $this->get('/articles');
        $this->assertResponseOk();
    }
}
`;
      const res = classifyFile("tests/TestCase/Controller/ArticlesControllerTest.php", code);
      expect(res.layer).toBe("integration");
      expect(res.language).toBe("PHP");
    });

    it("classifies CakePHP model unit tests as Unit", () => {
      const code = `<?php
namespace App\\Test\\TestCase\\Model\\Table;

use App\\Model\\Table\\ArticlesTable;
use Cake\\TestSuite\\TestCase;

class ArticlesTableTest extends TestCase
{
    public function testValidation(): void
    {
        $article = $this->Articles->newEntity(['title' => '']);
        $this->assertNotEmpty($article->getErrors());
    }
}
`;
      const res = classifyFile("tests/TestCase/Model/ArticlesTableTest.php", code);
      expect(res.layer).toBe("unit");
      expect(res.language).toBe("PHP");
    });
  });

  describe("Symfony", () => {
    it("classifies Symfony Panther tests as E2E", () => {
      const code = `<?php
namespace App\\Tests;

use Symfony\\Component\\Panther\\PantherTestCase;

class ContactTest extends PantherTestCase
{
    public function testContactPage(): void
    {
        $client = static::createPantherClient();
        $crawler = $client->request('GET', '/contact');
        $this->assertSelectorTextContains('h1', 'Contact Us');
    }
}
`;
      const res = classifyFile("tests/ContactTest.php", code);
      expect(res.layer).toBe("e2e");
      expect(res.reasons).toContain("Symfony Panther browser testing");
    });

    it("classifies Symfony WebTestCase as Integration", () => {
      const code = `<?php
namespace App\\Tests;

use Symfony\\Bundle\\FrameworkBundle\\Test\\WebTestCase;

class BlogControllerTest extends WebTestCase
{
    public function testIndex(): void
    {
        $client = static::createClient();
        $crawler = $client->request('GET', '/blog');
        $this->assertResponseIsSuccessful();
    }
}
`;
      const res = classifyFile("tests/BlogControllerTest.php", code);
      expect(res.layer).toBe("integration");
      expect(res.reasons).toContain("Symfony Web/Kernel integration test case");
    });
  });

  describe("Pest & PHP 8 Attributes", () => {
    it("extracts test counts from PHP 8 #[Test] attributes", () => {
      const code = `<?php
use PHPUnit\\Framework\\TestCase;
use PHPUnit\\Framework\\Attributes\\Test;

class OrderTest extends TestCase
{
    #[Test]
    public function user_can_place_order(): void
    {
        $this->assertTrue(true);
    }

    #[Test]
    public function user_can_cancel_order(): void
    {
        $this->assertTrue(true);
    }
}
`;
      expect(countTestCases(code)).toBe(2);
    });

    it("classifies Pest tests", () => {
      const code = `<?php
test('has home page', function () {
    $response = $this->get('/');
    $response->assertStatus(200);
});

it('can fetch profile', function () {
    $response = $this->get('/profile');
    $response->assertStatus(200);
});
`;
      const res = classifyFile("tests/Feature/HomeTest.php", code);
      expect(res.layer).toBe("integration");
      expect(res.testCaseCount).toBe(2);
    });
  });

  describe("PHP Static Analysis Detection", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "testscales-php-"));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("detects PHPStan with strict mode level 9", () => {
      writeFileSync(
        join(tempDir, "phpstan.neon"),
        `parameters:
    level: 9
    paths:
        - app
`,
      );
      const result = detectConfigs(tempDir);
      const phpstan = result.staticTools.find((t) => t.name === "PHPStan");
      expect(phpstan).toBeDefined();
      expect(phpstan?.category).toBe("typechecker");
      expect(phpstan?.isStrict).toBe(true);
    });

    it("detects Psalm with strict errorLevel 1", () => {
      writeFileSync(
        join(tempDir, "psalm.xml"),
        `<?xml version="1.0"?>
<psalm errorLevel="1">
    <projectFiles>
        <directory name="src" />
    </projectFiles>
</psalm>
`,
      );
      const result = detectConfigs(tempDir);
      const psalm = result.staticTools.find((t) => t.name === "Psalm");
      expect(psalm).toBeDefined();
      expect(psalm?.category).toBe("typechecker");
      expect(psalm?.isStrict).toBe(true);
    });

    it("detects Pint and Rector", () => {
      writeFileSync(join(tempDir, "pint.json"), `{"preset": "laravel"}`);
      writeFileSync(join(tempDir, "rector.php"), `<?php return static function () {};`);
      const result = detectConfigs(tempDir);
      expect(result.staticTools.some((t) => t.name === "Pint")).toBe(true);
      expect(result.staticTools.some((t) => t.name === "Rector")).toBe(true);
    });

    it("detects PHP tools from composer.json", () => {
      writeFileSync(
        join(tempDir, "composer.json"),
        JSON.stringify({
          require: { php: "^8.2" },
          "require-dev": {
            "phpstan/phpstan": "^1.10",
            "laravel/pint": "^1.13",
          },
        }),
      );
      const result = detectConfigs(tempDir);
      expect(result.staticTools.some((t) => t.name === "PHPStan")).toBe(true);
      expect(result.staticTools.some((t) => t.name === "Pint")).toBe(true);
    });
  });

  describe("File Patterns", () => {
    it("recognizes PHPUnit and Pest file names as tests", () => {
      expect(isTestFile("tests/Unit/UserTest.php")).toBe(true);
      expect(isTestFile("tests/Feature/user.test.php")).toBe(true);
      expect(isTestFile("app/Models/User.php")).toBe(false);
    });
  });
});
