#!/bin/sh
# Checks that every file copied from T3 Code is credited and security reviewed.
#
# Usage: scripts/check-credits.sh [root]
#
# The root defaults to the repository that holds this script, so the check gives
# the same answer from any working directory. The check passes when:
#   - third_party/t3code/LICENSE exists;
#   - NOTICE names third_party/t3code/<package> for every package directory;
#   - every copied file has a row in third_party/t3code/README.md, and every row
#     names a file that exists;
#   - a copyright line quoted in a row is still present in that file;
#   - every copied file has a row in third_party/t3code/SECURITY-REVIEW.md, and
#     every row names a file that exists.
# Package metadata files (README.md, LICENSE, SECURITY-REVIEW.md, package.json,
# tsconfig.json at the top of third_party/t3code and of each package) and
# node_modules directories are not copied code and need no rows.
# Every problem is printed to standard error with the path it concerns. The
# exit status is 1 when there is any problem and 0 when there is none.

if [ "$#" -gt 0 ]; then
  root=$1
else
  self=$0
  hops=0
  while [ -L "$self" ]; do
    hops=$((hops + 1))
    if [ "$hops" -gt 40 ]; then
      echo "check-credits: too many symbolic links resolving $0" >&2
      exit 1
    fi
    target=$(readlink "$self") || exit 1
    case $target in
      /*) self=$target ;;
      *) self=${self%/*}/$target ;;
    esac
  done
  case $self in
    */*) here=${self%/*} ;;
    *) here=. ;;
  esac
  root=$(CDPATH= cd -- "$here/.." && pwd -P) || exit 1
fi

base=$root/third_party/t3code
readme=$base/README.md
review=$base/SECURITY-REVIEW.md
notice=$root/NOTICE
readme_header='| Package | File here | File in T3 Code | Copyright line | Changes |'
review_header='| File | Result |'

# Prints "path<TAB>copyright" for each data row of the table under the header.
# Arguments: file, exact header line, path column, copyright column (0 for none).
# Backticks and the spaces around a cell are removed.
table_rows() {
  awk -F'|' -v header="$2" -v pathcol="$3" -v copycol="$4" '
    function clean(cell) {
      gsub(/`/, "", cell)
      sub(/^[ \t]+/, "", cell)
      sub(/[ \t\r]+$/, "", cell)
      return cell
    }
    {
      line = $0
      sub(/[ \t\r]+$/, "", line)
    }
    line == header { inside = 1; next }
    inside && line !~ /^\|/ { inside = 0 }
    inside && line ~ /^\|[ \t:|-]+\|$/ { next }
    inside {
      path = clean($pathcol)
      copyright = copycol > 0 ? clean($copycol) : ""
      if (copyright == "") copyright = "none in original"
      print path "\t" copyright
    }
  ' "$1"
}

problems=$(
  if [ ! -d "$base" ]; then
    echo "$base: directory is missing"
    exit 0
  fi
  [ -f "$base/LICENSE" ] || echo "third_party/t3code/LICENSE: licence text is missing"
  [ -f "$notice" ] || echo "NOTICE: file is missing"
  [ -f "$readme" ] || echo "third_party/t3code/README.md: file is missing"
  [ -f "$review" ] || echo "third_party/t3code/SECURITY-REVIEW.md: file is missing"

  # Every copied file, relative to third_party/t3code.
  files=$(
    cd "$base" || exit 1
    find . -type d -name node_modules -prune -o -type f -print |
      sed 's|^\./||' | LC_ALL=C sort |
      while IFS= read -r path; do
        case $path in
          README.md | LICENSE | SECURITY-REVIEW.md | package.json | tsconfig.json) continue ;;
          */*/*) ;;
          */README.md | */LICENSE | */SECURITY-REVIEW.md | */package.json | */tsconfig.json) continue ;;
        esac
        printf '%s\n' "$path"
      done
  )

  # NOTICE must name every package directory.
  if [ -f "$notice" ]; then
    for dir in "$base"/*/; do
      [ -d "$dir" ] || continue
      name=${dir%/}
      name=${name##*/}
      [ "$name" = node_modules ] && continue
      if ! grep -Eq "third_party/t3code/$name([^A-Za-z0-9_-]|\$)" "$notice"; then
        echo "third_party/t3code/$name: package is not named in NOTICE"
      fi
    done
  fi

  if [ -f "$readme" ]; then
    rows=$(table_rows "$readme" "$readme_header" 3 5)
    row_paths=$(printf '%s\n' "$rows" | awk -F'\t' 'NF { print $1 }')
    printf '%s\n' "$files" | while IFS= read -r path; do
      [ -n "$path" ] || continue
      printf '%s\n' "$row_paths" | grep -Fxq -- "$path" ||
        echo "third_party/t3code/$path: no row in third_party/t3code/README.md"
    done
    printf '%s\n' "$rows" | while IFS="$(printf '\t')" read -r path copyright; do
      [ -n "$path" ] || continue
      if [ ! -f "$base/$path" ]; then
        echo "third_party/t3code/$path: README.md row names a file that does not exist"
      elif [ "$copyright" != "none in original" ] && ! grep -Fq -- "$copyright" "$base/$path"; then
        echo "third_party/t3code/$path: copyright line is missing from the file: $copyright"
      fi
    done
  fi

  if [ -f "$review" ]; then
    review_paths=$(table_rows "$review" "$review_header" 2 0 | awk -F'\t' 'NF { print $1 }')
    printf '%s\n' "$files" | while IFS= read -r path; do
      [ -n "$path" ] || continue
      printf '%s\n' "$review_paths" | grep -Fxq -- "$path" ||
        echo "third_party/t3code/$path: no row in third_party/t3code/SECURITY-REVIEW.md"
    done
    printf '%s\n' "$review_paths" | while IFS= read -r path; do
      [ -n "$path" ] || continue
      [ -f "$base/$path" ] ||
        echo "third_party/t3code/$path: SECURITY-REVIEW.md row names a file that does not exist"
    done
  fi
)

if [ -n "$problems" ]; then
  printf '%s\n' "$problems" >&2
  exit 1
fi
exit 0
