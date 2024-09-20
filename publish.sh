#!/bin/bash

c='\033[0;35m'
y='\033[0;33m'
r='\033[0;31m'
c0='\033[0;0m'
g='\033[0;32m'

echo_r() { /bin/echo -e ${r}"$1"${c0};  };

# shellcheck disable=SC2120
exit_on_error(){
  if [[ $? -ne 0 ]] ; then
    if [[ -n "$1" ]]; then
      echo_r "$1";
    else
      echo -e "${r}**** ERROR ****${c0}"
    fi;
    read -p "Press any key to resume ..."
    exit 0
  fi
}

set +e

branch_name=$(git symbolic-ref --short HEAD)
exit_on_error "$y**** Version will not be bumped since retcode is not equals 0 ****$c0"

expected_branch="master"
if [[ "$branch_name" != "$expected_branch" ]] ; then
  echo -e "${y}**** git ветка должна быть ${c}{$expected_branch}${y}, текущая: ${c}${branch_name}${y}  ****$c0"
  read -p "Press any key to resume ..."
  exit 0
fi

npm run cb
exit_on_error "$y**** Typescript build failed ****$c0"


old_version=''
new_version=''

update_version(){
    old_version=`cat package.json | grep version | head -1 | awk -F: '{ print $2 }' | sed 's/[\",]//g' | tr -d '[[:space:]]'`
    echo -e "$c**** Old version is $g$old_version$c ****$c0"
    version_split=( ${old_version//./ } )
    major=${version_split[0]:-0}
    minor=${version_split[1]:-0}
    patch=${version_split[2]:-0}
    let "patch=patch+1"
    new_version="${major}.${minor}.${patch}"

    repo=`cat package.json | grep name | head -1 | awk -F: '{ print $2 }' | sed 's/[\",]//g' | tr -d '[[:space:]]'`
    echo -e "$c**** Bumping version of $g$repo$c: $y$old_version$c -> $g$new_version$c  ****$c0"
    sed -i -e "0,/$old_version/s/$old_version/$new_version/" package.json
    echo -e "$g"
    npm version 2>&1 | head -2 | tail -1
    echo -e "$c0"
}


update_version
exit_on_error

git add --all
exit_on_error

git commit --no-verify -m "$new_version"
exit_on_error

git push github refs/heads/master:master
exit_on_error

npm publish
read -p "Press any key to resume ..."
