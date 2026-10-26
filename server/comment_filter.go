package main

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const maxSensitiveWordsFile = 64 << 10
const maxSensitiveWords = 2000

// Deliberately narrow: criticism, brand names and political views are not
// sensitive by default. This is a local rule filter, not semantic moderation.
var builtInSensitiveWords = []string{
	"傻逼", "傻比", "傻屄", "煞笔", "脑残", "贱人", "婊子", "操你妈", "草你妈", "艹你妈", "他妈的", "你妈的", "妈了个逼",
	"弄死你", "杀了你", "干死你", "约炮", "裸聊", "招嫖", "卖淫", "嫖娼",
	"fuck", "fucking", "motherfucker", "shit", "bitch",
}

type sensitiveNode struct {
	children  map[rune]*sensitiveNode
	terminal  bool
	asciiWord bool
}
type CommentFilter struct{ root *sensitiveNode }
type sensitiveSpan struct{ start, end int }
type privacyRule struct {
	rx      *regexp.Regexp
	capture int
	digits  bool
	card    bool
}

var commentPrivacyRules = []privacyRule{
	{rx: regexp.MustCompile(`(?i)[a-z0-9.!#$%&'*+/=?^_{}|~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+`)},
	{rx: regexp.MustCompile(`(?:\+?86[ -]?)?1[3-9](?:[ -]?[0-9]){9}`), digits: true},
	{rx: regexp.MustCompile(`[1-9][0-9]{5}(?:18|19|20)[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])[0-9]{3}[0-9Xx]`), digits: true},
	{rx: regexp.MustCompile(`[0-9](?:[ -]?[0-9]){12,18}`), digits: true, card: true},
	{rx: regexp.MustCompile(`(?i)\b(?:sk|rk|pk|ghp|gho|ghu|ghs|ghr|github_pat)[_-][a-z0-9_-]{16,}`)},
	{rx: regexp.MustCompile(`(?i)\bbearer[ \t]+([a-z0-9._~+/=-]{16,})`), capture: 1},
	{rx: regexp.MustCompile(`(?i)(?:api[_ -]?key|access[_ -]?token|admin[_ -]?token|api[_ -]?token|secret|password|passwd|密码|密钥)[ \t]*[:=：][ \t]*["']?([^\s"'，。；;<>]{8,})`), capture: 1},
	{rx: regexp.MustCompile(`(?i)\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}`)},
}

func normalizedSensitiveRune(r rune) rune {
	if r >= '\uff01' && r <= '\uff5e' {
		r -= 0xfee0
	}
	return unicode.ToLower(r)
}
func ignoredSensitiveRune(r rune) bool {
	return unicode.IsSpace(r) || unicode.Is(unicode.Cf, r) || strings.ContainsRune("._-*·•", r)
}

func sensitiveWordBoundary(original []rune, start, end int) bool {
	left, right := start-1, end
	for left >= 0 && unicode.Is(unicode.Cf, original[left]) {
		left--
	}
	for right < len(original) && unicode.Is(unicode.Cf, original[right]) {
		right++
	}
	return (left < 0 || !asciiWordRune(normalizedSensitiveRune(original[left]))) && (right >= len(original) || !asciiWordRune(normalizedSensitiveRune(original[right])))
}
func asciiWordRune(r rune) bool { return r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_' }

func newCommentFilter(words []string) (*CommentFilter, error) {
	if len(words) > maxSensitiveWords {
		return nil, errors.New("too many sensitive words")
	}
	f := &CommentFilter{root: &sensitiveNode{children: map[rune]*sensitiveNode{}}}
	for _, word := range words {
		if !utf8.ValidString(word) {
			return nil, errors.New("invalid sensitive words encoding")
		}
		var chars []rune
		ascii := true
		for _, r := range word {
			if unicode.IsControl(r) {
				return nil, errors.New("control character in sensitive word")
			}
			r = normalizedSensitiveRune(r)
			if ignoredSensitiveRune(r) {
				continue
			}
			chars = append(chars, r)
			ascii = ascii && asciiWordRune(r)
		}
		if len(chars) < 2 || len(chars) > 64 {
			return nil, errors.New("sensitive words must have 2-64 effective characters")
		}
		node := f.root
		for _, r := range chars {
			if node.children[r] == nil {
				node.children[r] = &sensitiveNode{children: map[rune]*sensitiveNode{}}
			}
			node = node.children[r]
		}
		node.terminal = true
		node.asciiWord = ascii
	}
	return f, nil
}

var defaultCommentFilter = func() *CommentFilter {
	f, err := newCommentFilter(builtInSensitiveWords)
	if err != nil {
		panic("invalid built-in comment filter")
	}
	return f
}()

// The optional runtime dictionary is additive and never distributed with the
// public application package. Invalid data fails validation, never fails open.
func loadCommentFilter(dir string) (*CommentFilter, error) {
	path := filepath.Join(dir, "comment-sensitive-words.txt")
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return defaultCommentFilter, nil
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > maxSensitiveWordsFile {
		return nil, errors.New("invalid sensitive words file")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxSensitiveWordsFile+1))
	if err != nil || len(data) > maxSensitiveWordsFile || !utf8.Valid(data) {
		return nil, errors.New("invalid sensitive words file")
	}
	words := append([]string{}, builtInSensitiveWords...)
	for _, line := range strings.Split(strings.TrimPrefix(string(data), "\ufeff"), "\n") {
		line = strings.TrimSpace(line)
		if line != "" && !strings.HasPrefix(line, "#") {
			words = append(words, line)
		}
	}
	return newCommentFilter(words)
}

func validCardNumber(s string) bool {
	var digits []int
	for _, r := range s {
		if r >= '0' && r <= '9' {
			digits = append(digits, int(r-'0'))
		}
	}
	if len(digits) < 13 || len(digits) > 19 {
		return false
	}
	sum, different := 0, false
	for i, d := range digits {
		different = different || d != digits[0]
		if (len(digits)-i)%2 == 0 {
			d *= 2
			if d > 9 {
				d -= 9
			}
		}
		sum += d
	}
	return different && sum%10 == 0
}

func (f *CommentFilter) mask(text string) (string, bool) {
	if f == nil {
		f = defaultCommentFilter
	}
	original := []rune(text)
	var chars []rune
	var positions []int
	for i, r := range original {
		r = normalizedSensitiveRune(r)
		if !ignoredSensitiveRune(r) {
			chars = append(chars, r)
			positions = append(positions, i)
		}
	}
	var spans []sensitiveSpan
	for start := 0; start < len(chars); {
		node, end := f.root, -1
		for j := start; j < len(chars) && j-start < 64; j++ {
			node = node.children[chars[j]]
			if node == nil {
				break
			}
			if node.terminal && (!node.asciiWord || sensitiveWordBoundary(original, positions[start], positions[j]+1)) {
				end = j + 1
			}
		}
		if end > start {
			spans = append(spans, sensitiveSpan{positions[start], positions[end-1] + 1})
			start = end
		} else {
			start++
		}
	}
	// Regexes retain punctuation and spacing; byte offsets map back to original
	// runes so full-width characters, emoji and zero-width evasions mask safely.
	var normalized strings.Builder
	var bytePositions []int
	for i, r := range original {
		if unicode.Is(unicode.Cf, r) {
			continue
		}
		r = normalizedSensitiveRune(r)
		normalized.WriteRune(r)
		for n := 0; n < utf8.RuneLen(r); n++ {
			bytePositions = append(bytePositions, i)
		}
	}
	patternText := normalized.String()
	for _, rule := range commentPrivacyRules {
		for _, indices := range rule.rx.FindAllStringSubmatchIndex(patternText, -1) {
			start, end := indices[rule.capture*2], indices[rule.capture*2+1]
			if start < 0 || end <= start {
				continue
			}
			if rule.digits && (start > 0 && patternText[start-1] >= '0' && patternText[start-1] <= '9' || end < len(patternText) && patternText[end] >= '0' && patternText[end] <= '9') {
				continue
			}
			if rule.card && !validCardNumber(patternText[start:end]) {
				continue
			}
			spans = append(spans, sensitiveSpan{bytePositions[start], bytePositions[end-1] + 1})
		}
	}
	if len(spans) == 0 {
		return text, false
	}
	masked := make([]bool, len(original))
	for _, span := range spans {
		for i := span.start; i < span.end; i++ {
			masked[i] = true
		}
	}
	var out strings.Builder
	for i := 0; i < len(original); {
		if !masked[i] {
			out.WriteRune(original[i])
			i++
			continue
		}
		start := i
		for i < len(original) && masked[i] {
			i++
		}
		// Never expand a short word beyond the accepted nickname/body limit.
		out.WriteString(strings.Repeat("*", min(3, i-start)))
	}
	return out.String(), true
}

func (f *CommentFilter) sanitize(c Comment) (Comment, bool) {
	name, nameChanged := f.mask(c.Name)
	body, bodyChanged := f.mask(c.Body)
	c.Name, c.Body = name, body
	return c, nameChanged || bodyChanged
}
