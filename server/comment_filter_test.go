package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"
)

func TestCommentFilterPreservesCriticismAndMasksOnlyMatches(t *testing.T) {
	cases := []struct{ name, input, want string }{
		{"criticism", "DeepSeek很差，GLM宣传夸大，Qwen不适合我。", "DeepSeek很差，GLM宣传夸大，Qwen不适合我。"},
		{"technical", "死循环、脑机接口、手机号字段。class assignment, birch, shItake。", "死循环、脑机接口、手机号字段。class assignment, birch, shItake。"},
		{"Chinese abuse", "不要说傻逼，认真讨论。", "不要说**，认真讨论。"},
		{"obfuscated abuse", "🙂傻\u200b. 逼😐", "🙂***😐"},
		{"English word", "this is SHIT, not class", "this is ***, not class"},
		{"fullwidth", "ＦＵＣＫ！", "***！"},
		{"spaced word", "a f u c k test", "a *** test"},
		{"phone", "联系13800138000谢谢", "联系***谢谢"},
		{"spaced phone", "电话 +86 138-0013-8000，谢谢", "电话 ***，谢谢"},
		{"fullwidth phone", "电话１３８００１３８０００", "电话***"},
		{"zero width phone", "电话138\u200b00138000", "电话***"},
		{"email", "联系 test+news@example.com 谢谢", "联系 *** 谢谢"},
		{"ID", "证件11010519491231002X勿泄露", "证件***勿泄露"},
		{"card", "测试卡4111 1111 1111 1111勿填写", "测试卡***勿填写"},
		{"API key", "密钥 sk-abcdefghijklmnopqrstuvwx，别发", "密钥 ***，别发"},
		{"Bearer", "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456", "Authorization: Bearer ***"},
		{"assignment", "API_TOKEN=abcdefghijklmnopqrstu", "API_TOKEN=***"},
		{"password", "密码：abcdefgh123456", "密码：***"},
		{"JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop", "***"},
		{"model versions", "GLM5.3 / Kimi K3 / Qwen3.8 / 8198 / 65.7%", "GLM5.3 / Kimi K3 / Qwen3.8 / 8198 / 65.7%"},
		{"already masked", "电话***，昵称**", "电话***，昵称**"},
		{"empty", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, masked := defaultCommentFilter.mask(tc.input)
			if got != tc.want || masked != (got != tc.input) {
				t.Fatalf("got %q (%v), want %q", got, masked, tc.want)
			}
			if !utf8.ValidString(got) || utf8.RuneCountInString(got) > utf8.RuneCountInString(tc.input) {
				t.Fatal("invalid or expanded output")
			}
		})
	}
}

func TestCustomSensitiveWordsAndFileValidation(t *testing.T) {
	dir := t.TempDir()
	if _, err := loadCommentFilter(dir); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "comment-sensitive-words.txt")
	if err := os.WriteFile(path, []byte("\ufeff# literal words, not regex\n自定义词\n更长自定义词\n"), 0600); err != nil {
		t.Fatal(err)
	}
	filter, err := loadCommentFilter(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := filter.mask("测试更长自定义词和自定义词"); got != "测试***和***" {
		t.Fatal(got)
	}
	for _, data := range [][]byte{[]byte("x"), {0xff}, []byte("a\x00b"), []byte(strings.Repeat("长", 65)), []byte(strings.Repeat("界", maxSensitiveWordsFile))} {
		os.WriteFile(path, data, 0600)
		if _, err := loadCommentFilter(dir); err == nil {
			t.Fatal("invalid dictionary accepted")
		}
	}
	os.Remove(path)
	os.Symlink(filepath.Join(dir, "other"), path)
	if _, err := loadCommentFilter(dir); err == nil {
		t.Fatal("symlink accepted")
	}
	if _, err := newCommentFilter(make([]string, maxSensitiveWords+1)); err == nil {
		t.Fatal("unbounded dictionary")
	}
}

func TestCommentFilterConcurrencyAndLimits(t *testing.T) {
	var wg sync.WaitGroup
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for n := 0; n < 20; n++ {
				got, changed := defaultCommentFilter.mask("🙂test@example.com 傻 逼 电话13800138000，正常批评保留")
				if !changed || strings.Contains(got, "example.com") || !strings.HasSuffix(got, "正常批评保留") {
					t.Error("concurrent filter failure")
				}
			}
		}()
	}
	wg.Wait()
	input := strings.Repeat("傻逼 ", 666)
	out, _ := defaultCommentFilter.mask(input)
	if utf8.RuneCountInString(out) > maxCommentRunes {
		t.Fatal("masked output grew past body limit")
	}
}

func TestCommentMaskingBeforePublicResponseAndPersistence(t *testing.T) {
	app := fixture(t)
	input := map[string]string{"name": "test@example.com", "body": "电话13800138000，不要说傻逼，批评模型可以。"}
	w := publicPost(app, "/api/articles/existing/comments", input, "http://example.test")
	status(t, w, 201)
	var response commentSubmitResponse
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Status != "approved" || !response.Masked || response.Comment == nil || response.Comment.Name != "***" || response.Comment.Body != "电话***，不要说**，批评模型可以。" {
		t.Fatal("invalid masked response")
	}
	data, err := os.ReadFile(app.comments.path)
	if err != nil {
		t.Fatal(err)
	}
	for _, sensitive := range []string{"13800138000", "example.com", "傻逼"} {
		if strings.Contains(string(data), sensitive) || strings.Contains(w.Body.String(), sensitive) {
			t.Fatal("unmasked content persisted or returned")
		}
	}
	public := request(app, "GET", "/api/articles/existing/comments", nil, nil, "", "", "")
	if !strings.Contains(public.Body.String(), response.Comment.Body) {
		t.Fatal("masked comment not publicly visible")
	}
	if _, err := newCommentStore(filepath.Dir(app.comments.path)); err != nil {
		t.Fatal("old comment schema was changed")
	}
}

func TestCommentFailureDoesNotPublishOrAdvanceMemory(t *testing.T) {
	app := fixture(t)
	app.comments.write = func(string, []byte) error { return errors.New("disk full") }
	status(t, publicPost(app, "/api/articles/existing/comments", map[string]string{"body": "test@example.com敏感信息"}, "http://example.test"), 500)
	if len(app.comments.all()) != 0 || len(app.comments.public("existing")) != 0 {
		t.Fatal("failed write was published")
	}
}

func TestApplyCommentPolicyIsExplicitAtomicAndPreservesHidden(t *testing.T) {
	app := fixture(t)
	cookie := login(t, app)
	comments := []Comment{
		{ID: "old-pending", ArticleID: "existing", Name: "读者", Body: "电话13800138000", Status: "pending", CreatedAt: "2026-10-26"},
		{ID: "old-approved", ArticleID: "existing", Name: "test@example.com", Body: "正常批评", Status: "approved", CreatedAt: "2026-10-26"},
		{ID: "old-hidden", ArticleID: "existing", Name: "读者", Body: "保留人工隐藏", Status: "hidden", CreatedAt: "2026-10-26"},
		{ID: "old-draft", ArticleID: "secret-draft", Name: "读者", Body: "未发布文章的待审", Status: "pending", CreatedAt: "2026-10-26"},
	}
	if err := app.comments.commit(comments); err != nil {
		t.Fatal(err)
	}
	url := "/api/admin/comments/auto-publish"
	status(t, publicPost(app, url, map[string]any{}, "http://example.test"), 401)
	status(t, request(app, "POST", url, map[string]any{}, cookie, "http://evil.test", "model-insight", ""), 403)
	status(t, adminRequest(app, "POST", url, map[string]any{"unexpected": true}, cookie), 400)
	app.comments.write = func(string, []byte) error { return errors.New("disk full") }
	status(t, adminRequest(app, "POST", url, map[string]any{}, cookie), 500)
	if app.comments.all()[0].Status != comments[0].Status {
		t.Fatal("failed batch advanced memory")
	}
	app.comments.write = atomicWrite
	w := adminRequest(app, "POST", url, map[string]any{}, cookie)
	status(t, w, 200)
	var result map[string]int
	json.Unmarshal(w.Body.Bytes(), &result)
	if result["published"] != 1 || result["masked"] != 2 {
		t.Fatal(result)
	}
	byID := map[string]Comment{}
	for _, c := range app.comments.all() {
		byID[c.ID] = c
	}
	if byID["old-hidden"] != comments[2] || byID["old-draft"] != comments[3] || byID["old-pending"].Status != "approved" || byID["old-pending"].Body != "电话***" || byID["old-approved"].Name != "***" {
		t.Fatal("unexpected batch changes")
	}
	w = adminRequest(app, "POST", url, map[string]any{}, cookie)
	json.Unmarshal(w.Body.Bytes(), &result)
	if result["published"] != 0 || result["masked"] != 0 {
		t.Fatal("batch not idempotent")
	}
	reloaded, err := newCommentStore(filepath.Dir(app.comments.path))
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range reloaded.all() {
		if c.ID == "old-hidden" && c.Status != "hidden" {
			t.Fatal("restart resurrected hidden comment")
		}
	}
	if _, err = app.comments.moderate("old-pending", "hidden", nil); err != nil {
		t.Fatal(err)
	}
	if _, err = app.comments.moderate("old-pending", "approved", nil); err != nil {
		t.Fatal(err)
	}
}
